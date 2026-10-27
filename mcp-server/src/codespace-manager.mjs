import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectRepositoryContext } from './git-context.mjs';
import { createGhClient } from './gh-client.mjs';
import { runCodespaceCommand, validateCodespaceName } from './process-runner.mjs';
import { buildLocalPatch, buildRemoteWorktreeCommand } from './local-sync.mjs';

const DEFAULT_STARTUP_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const LOCK_WAIT_TIMEOUT_MS = 20 * 60 * 1000;

function normalizeRepository(value) {
  if (typeof value === 'string') return value.toLowerCase();
  return String(value?.full_name || '').toLowerCase();
}

function normalizeBranch(value) {
  return typeof value === 'string' ? value.replace(/^refs\/heads\//, '') : '';
}

export function findMatchingCodespace(codespaces, repository, branch) {
  const repoKey = repository.toLowerCase();
  return codespaces.find(codespace => {
    const repo = normalizeRepository(codespace.repository ?? codespace.repository?.full_name);
    const ref = normalizeBranch(codespace.gitStatus?.ref || codespace.git_status?.ref);
    return repo === repoKey && ref === branch;
  }) || null;
}

function isAvailable(state) {
  return String(state || '').toLowerCase() === 'available';
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function removeStaleLock(lockPath) {
  try {
    const [raw, info] = await Promise.all([readFile(lockPath, 'utf8'), stat(lockPath)]);
    let owner;
    try { owner = JSON.parse(raw); } catch {}
    if (owner?.pid && processIsAlive(owner.pid)) return false;
    if (!owner?.pid && Date.now() - info.mtimeMs < 5_000) return false;
    await unlink(lockPath);
    return true;
  } catch (error) {
    return error.code === 'ENOENT';
  }
}

export async function withRepositoryLock(key, operation, {
  directory = join(tmpdir(), 'antigravity-codespaces-mcp-locks'),
  timeoutMs = LOCK_WAIT_TIMEOUT_MS,
  pollIntervalMs = 250,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = `${createHash('sha256').update(key).digest('hex')}.lock`;
  const lockPath = join(directory, filename);
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      } catch (writeError) {
        await handle.close().catch(() => {});
        await unlink(lockPath).catch(() => {});
        handle = undefined;
        throw writeError;
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await removeStaleLock(lockPath);
      if (Date.now() >= deadline) throw new Error('Timed out waiting for another MCP request to finish preparing this repository Codespace.');
      await sleep(pollIntervalMs);
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}

export function createCodespaceManager({
  gh = createGhClient(),
  runCommand = runCodespaceCommand,
  detectContext = detectRepositoryContext,
  lock = withRepositoryLock,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS
} = {}) {
  async function waitUntilAvailable(name) {
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      const status = await gh.getCodespace(name);
      if (isAvailable(status.state)) return status;
      if (['deleted', 'failed', 'unavailable'].includes(String(status.state || '').toLowerCase())) {
        throw new Error(`Codespace ${name} entered state ${status.state}.`);
      }
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    }
    throw new Error(`Codespace ${name} did not become available within ${Math.round(startupTimeoutMs / 1000)} seconds.`);
  }

  async function ensureAvailable(context) {
    const codespaces = await gh.listCodespaces();
    let codespace = findMatchingCodespace(codespaces, context.repository, context.branch);
    let created = false;
    let started = false;
    if (!codespace) {
      codespace = await gh.createCodespace(context.repository, context.branch);
      created = true;
    } else if (!isAvailable(codespace.state)) {
      await gh.startCodespace(codespace.name);
      started = true;
    }
    try {
      const status = await waitUntilAvailable(codespace.name);
      return { codespace: { ...codespace, ...status }, created, started };
    } catch (error) {
      if (created || started) {
        try { await gh.stopCodespace(codespace.name); }
        catch (stopError) { error.message += ` Cleanup also failed: ${stopError.message}`; }
      }
      throw error;
    }
  }

  async function cleanupIfOwned(codespaceName, owned) {
    if (!owned) return { stopped: false, error: null };
    try {
      const current = await gh.getCodespace(codespaceName);
      if (!isAvailable(current.state)) return { stopped: false, error: null };
      await gh.stopCodespace(codespaceName);
      return { stopped: true, error: null };
    } catch (error) {
      return { stopped: false, error: error.message };
    }
  }

  return {
    async listCodespaces() {
      return gh.listCodespaces();
    },

    async getCodespace(name) {
      validateCodespaceName(name);
      return gh.getCodespace(name);
    },

    async startCodespace(name) {
      validateCodespaceName(name);
      const current = await gh.getCodespace(name);
      if (!isAvailable(current.state)) {
        await gh.startCodespace(name);
        return waitUntilAvailable(name);
      }
      return current;
    },

    async stopCodespace(name) {
      validateCodespaceName(name);
      await gh.stopCodespace(name);
      return true;
    },

    async getCodespaceLogs(name) {
      validateCodespaceName(name);
      return gh.getCodespaceLogs(name);
    },

    async getCodespacePorts(name) {
      validateCodespaceName(name);
      return gh.getCodespacePorts(name);
    },

    async runRepositoryCommand({ cwd, command, timeoutMs, onOutput, syncLocalChanges = false }) {
      const context = await detectContext({ cwd });
      const localSnapshot = syncLocalChanges ? await buildLocalPatch(context.cwd) : null;
      const key = `${context.repository.toLowerCase()}\0${context.branch}`;
      return lock(key, async () => {
        const resource = await ensureAvailable(context);
        let result;
        let runError;
        try {
          const remoteCommand = localSnapshot
            ? buildRemoteWorktreeCommand({ repository: context.repository, head: localSnapshot.head, command, runId: randomUUID() })
            : command;
          result = await runCommand(
            { codespaceName: resource.codespace.name, command: remoteCommand, timeoutMs, input: localSnapshot?.patch },
            { onOutput }
          );
        } catch (error) {
          runError = error;
        }
        const cleanup = await cleanupIfOwned(resource.codespace.name, resource.created || resource.started);
        if (runError) {
          if (cleanup.error) runError.message += ` Cleanup also failed: ${cleanup.error}`;
          throw runError;
        }
        return {
          repository: context.repository,
          branch: context.branch,
          codespaceName: resource.codespace.name,
          created: resource.created,
          started: resource.started,
          stoppedAfterRun: cleanup.stopped,
          cleanupError: cleanup.error,
          localChangesSynced: Boolean(localSnapshot),
          result
        };
      });
    }
  };
}

export const codespaceManagerLimits = Object.freeze({
  startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS
});
