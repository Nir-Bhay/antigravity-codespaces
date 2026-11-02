import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectRepositoryContext } from './git-context.mjs';
import { createGhClient } from './gh-client.mjs';
import { runCodespaceCommand, validateCodespaceName, validateCommandInput } from './process-runner.mjs';
import { buildLocalPatch, buildRemoteWorktreeCommand } from './local-sync.mjs';
import { runPreflight } from './preflight.mjs';

const DEFAULT_STARTUP_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const LOCK_WAIT_TIMEOUT_MS = 20 * 60 * 1000;
const LOCAL_PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_LOCAL_PREVIEWS = 4;

function normalizeRepository(value) {
  if (typeof value === 'string') return value.toLowerCase();
  return String(value?.full_name || '').toLowerCase();
}

function normalizeBranch(value) {
  return typeof value === 'string' ? value.replace(/^refs\/heads\//, '') : '';
}

const STARTING_CODESPACE_STATES = new Set(['awaiting', 'creating', 'provisioning', 'queued', 'rebuilding', 'starting']);

function normalizeState(state) {
  return String(state || '').trim().toLowerCase();
}

function isAvailable(state) {
  return normalizeState(state) === 'available';
}

function isStopped(state) {
  return normalizeState(state) === 'shutdown';
}

function matchingCodespacePriority(state) {
  const normalized = normalizeState(state);
  if (normalized === 'available') return 0;
  if (STARTING_CODESPACE_STATES.has(normalized)) return 1;
  if (normalized === 'shutdown') return 2;
  if (normalized === 'shuttingdown') return 3;
  return 4;
}

export function findMatchingCodespace(codespaces, repository, branch) {
  const repoKey = repository.toLowerCase();
  const matches = codespaces.filter(codespace => {
    const repo = normalizeRepository(codespace.repository ?? codespace.repository?.full_name);
    const ref = normalizeBranch(codespace.gitStatus?.ref || codespace.git_status?.ref);
    return repo === repoKey && ref === branch;
  });
  return matches.reduce((best, candidate) => (
    matchingCodespacePriority(candidate.state) < matchingCodespacePriority(best.state) ? candidate : best
  ), matches[0]) || null;
}

async function startStoppedCodespace(gh, name, state, identityToken, waitUntilStopped, signal, onStart) {
  if (normalizeState(state) === 'shuttingdown') {
    state = await waitUntilStopped(name, identityToken, signal);
  }
  if (isStopped(state)) {
    onStart?.();
    await gh.startCodespace(name, {
      ...(identityToken === undefined ? {} : { identityToken }),
      ...(signal === undefined ? {} : { signal })
    });
    return true;
  }
  if (isAvailable(state) || STARTING_CODESPACE_STATES.has(normalizeState(state))) return false;
  throw new Error(`Cannot start Codespace ${name} while GitHub reports state "${state || 'unknown'}"; refresh and try again when it is stopped.`);
}

function cancellationError() {
  const error = new Error('Request was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancellationError();
}

async function waitForLockRetry(ms, signal, sleep) {
  throwIfAborted(signal);
  if (!signal) return sleep(ms);
  let onAbort;
  try {
    const retry = Promise.resolve().then(() => {
      throwIfAborted(signal);
      return sleep(ms);
    });
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(cancellationError());
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    await Promise.race([retry, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
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

async function readLockFile(lockPath) {
  const handle = await open(lockPath, 'r');
  try {
    const [raw, info] = await Promise.all([handle.readFile('utf8'), handle.stat()]);
    return { raw, info };
  } finally {
    await handle.close().catch(() => {});
  }
}

async function removeStaleLock(lockPath, beforeStaleLockUnlink) {
  try {
    const { raw, info } = await readLockFile(lockPath);
    let owner;
    try { owner = JSON.parse(raw); } catch {}
    if (owner?.pid && processIsAlive(owner.pid)) return false;
    if (!owner?.pid && Date.now() - info.mtimeMs < 5_000) return false;
    await beforeStaleLockUnlink?.({ lockPath, owner, info });

    // A competing reclaimer may have replaced this stale entry with a live owner's lock.
    const current = await readLockFile(lockPath);
    if (current.info.dev !== info.dev || current.info.ino !== info.ino || current.raw !== raw) return false;
    let currentOwner;
    try { currentOwner = JSON.parse(current.raw); } catch {}
    if (currentOwner?.pid && processIsAlive(currentOwner.pid)) return false;
    if (!currentOwner?.pid && Date.now() - current.info.mtimeMs < 5_000) return false;

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
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  beforeStaleLockUnlink,
  signal
} = {}) {
  throwIfAborted(signal);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = `${createHash('sha256').update(key).digest('hex')}.lock`;
  const lockPath = join(directory, filename);
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (!handle) {
    throwIfAborted(signal);
    try {
      handle = await open(lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
        throwIfAborted(signal);
      } catch (writeError) {
        await handle.close().catch(() => {});
        await unlink(lockPath).catch(() => {});
        handle = undefined;
        throw writeError;
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await removeStaleLock(lockPath, beforeStaleLockUnlink);
      if (Date.now() >= deadline) throw new Error('Timed out waiting for another MCP request to finish preparing this repository Codespace.');
      await waitForLockRetry(pollIntervalMs, signal, sleep);
    }
  }
  try {
    throwIfAborted(signal);
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
  now = () => Date.now(),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  preflight = runPreflight
} = {}) {
  async function pinIdentity(signal) {
    return typeof gh.pinIdentity === 'function' ? gh.pinIdentity(signal === undefined ? {} : { signal }) : undefined;
  }

  function identityOptions(identityToken, signal) {
    return {
      ...(identityToken === undefined ? {} : { identityToken }),
      ...(signal === undefined ? {} : { signal })
    };
  }

  async function cancellableSleep(ms, signal) {
    throwIfAborted(signal);
    if (!signal) return sleep(ms);
    let onAbort;
    try {
      await Promise.race([
        sleep(ms),
        new Promise((_, reject) => {
          onAbort = () => reject(cancellationError());
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        })
      ]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  async function waitUntilAvailable(name, identityToken, signal) {
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const status = await gh.getCodespace(name, identityOptions(identityToken, signal));
      if (isAvailable(status.state)) return status;
      if (['deleted', 'failed', 'unavailable'].includes(String(status.state || '').toLowerCase())) {
        throw new Error(`Codespace ${name} entered state ${status.state}.`);
      }
      await cancellableSleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), signal);
    }
    throw new Error(`Codespace ${name} did not become available within ${Math.round(startupTimeoutMs / 1000)} seconds.`);
  }

  async function waitUntilStopped(name, identityToken, signal) {
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const status = await gh.getCodespace(name, identityOptions(identityToken, signal));
      const state = normalizeState(status.state);
      if (isStopped(state) || isAvailable(state)) return status.state;
      if (['deleted', 'failed', 'unavailable'].includes(state)) {
        throw new Error(`Codespace ${name} entered state ${status.state}.`);
      }
      await cancellableSleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), signal);
    }
    throw new Error(`Codespace ${name} did not finish shutting down within ${Math.round(startupTimeoutMs / 1000)} seconds.`);
  }

  async function ensureAvailable(context, identityToken, signal) {
    let codespace;
    let created = false;
    let started = false;
    try {
      const codespaces = await gh.listCodespaces(identityOptions(identityToken, signal));
      codespace = findMatchingCodespace(codespaces, context.repository, context.branch);
      if (!codespace) {
        codespace = await gh.createCodespace(context.repository, context.branch, identityOptions(identityToken, signal));
        created = true;
      } else if (!isAvailable(codespace.state)) {
        started = await startStoppedCodespace(gh, codespace.name, codespace.state, identityToken, waitUntilStopped, signal, () => { started = true; }) || started;
      }
      const status = await waitUntilAvailable(codespace.name, identityToken, signal);
      return { codespace: { ...codespace, ...status }, created, started };
    } catch (error) {
      if (codespace && (created || started)) {
        try { await gh.stopCodespace(codespace.name, identityOptions(identityToken)); }
        catch (stopError) { error.message += ` Cleanup also failed: ${stopError.message}`; }
      }
      throw error;
    }
  }

  const localPreviews = new Map();

  function pruneLocalPreviews(currentTime = now(), reserveSlot = false) {
    for (const [previewId, snapshot] of localPreviews) {
      if (snapshot.expiresAt <= currentTime) localPreviews.delete(previewId);
    }
    while (reserveSlot && localPreviews.size >= MAX_LOCAL_PREVIEWS) {
      localPreviews.delete(localPreviews.keys().next().value);
    }
  }

  async function cleanupIfOwned(codespaceName, owned, identityToken) {
    if (!owned) return { stopped: false, error: null };
    try {
      const current = await gh.getCodespace(codespaceName, identityOptions(identityToken));
      if (!isAvailable(current.state)) return { stopped: false, error: null };
      await gh.stopCodespace(codespaceName, identityOptions(identityToken));
      return { stopped: true, error: null };
    } catch (error) {
      return { stopped: false, error: error.message };
    }
  }

  return {
    async preflightRepository({ cwd } = {}) {
      return preflight({ cwd, detectContext });
    },

    async previewLocalChanges({ cwd } = {}) {
      const context = await detectContext({ cwd });
      const snapshot = await buildLocalPatch(context.cwd);
      const createdAt = now();
      pruneLocalPreviews(createdAt, true);
      const previewId = randomUUID();
      const expiresAt = createdAt + LOCAL_PREVIEW_TTL_MS;
      localPreviews.set(previewId, {
        repository: context.repository.toLowerCase(),
        branch: context.branch,
        root: snapshot.root,
        head: snapshot.head,
        patch: snapshot.patch,
        files: snapshot.files,
        untrackedFiles: snapshot.untrackedFiles,
        patchBytes: snapshot.patchBytes,
        expiresAt
      });
      return {
        previewId,
        expiresAt: new Date(expiresAt).toISOString(),
        repository: context.repository,
        branch: context.branch,
        head: snapshot.head,
        files: snapshot.files,
        fileCount: snapshot.files.length,
        patchBytes: snapshot.patchBytes,
        transferLimitBytes: 5 * 1024 * 1024,
        codespaceProvisioningAttempted: false,
        untrackedFiles: snapshot.untrackedFiles,
        note: 'Ignored files are excluded. Local changes to tracked submodules are not supported. File names and byte count are shown; file contents are not returned. Pass previewId as localChangesPreviewId when opting into syncLocalChanges. The preview expires after 10 minutes and is single-use; syncing is refused if the repository, branch, HEAD, or local patch changes. Preview does not contact GitHub or provision a Codespace.'
      };
    },

    async listCodespaces({ signal } = {}) {
      return gh.listCodespaces(identityOptions(undefined, signal));
    },

    async getCodespace(name, { signal } = {}) {
      validateCodespaceName(name);
      return gh.getCodespace(name, identityOptions(undefined, signal));
    },

    async startCodespace(name, { signal } = {}) {
      validateCodespaceName(name);
      const identityToken = await pinIdentity(signal);
      const current = await gh.getCodespace(name, identityOptions(identityToken, signal));
      if (!isAvailable(current.state)) {
        await startStoppedCodespace(gh, name, current.state, identityToken, waitUntilStopped, signal);
        return waitUntilAvailable(name, identityToken, signal);
      }
      return current;
    },

    async stopCodespace(name, { signal } = {}) {
      validateCodespaceName(name);
      await gh.stopCodespace(name, identityOptions(undefined, signal));
      return true;
    },

    async getCodespaceLogs(name, { signal } = {}) {
      validateCodespaceName(name);
      return gh.getCodespaceLogs(name, identityOptions(undefined, signal));
    },

    async getCodespacePorts(name, { signal } = {}) {
      validateCodespaceName(name);
      return gh.getCodespacePorts(name, identityOptions(undefined, signal));
    },

    async runRepositoryCommand({ cwd, command, timeoutMs, onOutput, signal, syncLocalChanges = false, localChangesPreviewId } = {}) {
      const validated = validateCommandInput({ command, timeoutMs });
      if (localChangesPreviewId && !syncLocalChanges) throw new Error('localChangesPreviewId can only be used with syncLocalChanges=true.');
      const context = await detectContext({ cwd });
      let localSnapshot = null;
      if (syncLocalChanges) {
        if (typeof localChangesPreviewId !== 'string' || !localChangesPreviewId) {
          throw new Error('A current local-changes preview is required; call preview_local_changes before syncing.');
        }
        const currentTime = now();
        pruneLocalPreviews(currentTime);
        const reviewed = localPreviews.get(localChangesPreviewId);
        localPreviews.delete(localChangesPreviewId);
        if (!reviewed || reviewed.expiresAt <= currentTime) {
          throw new Error('The local-changes preview is missing or expired; call preview_local_changes again before syncing.');
        }
        const current = await buildLocalPatch(context.cwd);
        if (reviewed.repository !== context.repository.toLowerCase()
          || reviewed.branch !== context.branch
          || reviewed.root !== current.root
          || reviewed.head !== current.head
          || reviewed.patch !== current.patch) {
          throw new Error('Local changes or repository context changed since preview; review a fresh preview before syncing.');
        }
        localSnapshot = reviewed;
      }
      const remoteCommand = localSnapshot
        ? buildRemoteWorktreeCommand({ repository: context.repository, head: localSnapshot.head, command: validated.command, runId: randomUUID() })
        : validated.command;
      const key = `${context.repository.toLowerCase()}\0${context.branch}`;
      return lock(key, async () => {
        const identityToken = await pinIdentity(signal);
        const resource = await ensureAvailable(context, identityToken, signal);
        let result;
        let runError;
        try {
          result = await runCommand(
            { codespaceName: resource.codespace.name, command: remoteCommand, timeoutMs: validated.timeoutMs, input: localSnapshot?.patch },
            { onOutput, signal, ...identityOptions(identityToken) }
          );
        } catch (error) {
          runError = error;
        }
        const cleanup = await cleanupIfOwned(resource.codespace.name, resource.created || resource.started, identityToken);
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
      }, { signal });
    }
  };
}

export const codespaceManagerLimits = Object.freeze({
  startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS
});
