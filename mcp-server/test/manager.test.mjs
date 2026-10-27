import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCodespaceManager, findMatchingCodespace, withRepositoryLock } from '../src/codespace-manager.mjs';
import { validateRunInput } from '../src/process-runner.mjs';
import { detectRepositoryContext, parseGitHubRepository } from '../src/git-context.mjs';

function context(repository = 'octocat/hello-world', branch = 'feature/test') {
  return { repository, branch, cwd: '/tmp/repo' };
}

function fakeGh({ codespaces = [], state = 'Available' } = {}) {
  const calls = { list: 0, create: 0, start: 0, stop: 0 };
  let current = [...codespaces];
  return {
    calls,
    async listCodespaces() { calls.list++; return current; },
    async getCodespace(name) { return { ...(current.find(item => item.name === name) || {}), name, state }; },
    async createCodespace(repository, branch) {
      calls.create++;
      const created = { name: 'octocat-new-space', repository, gitStatus: { ref: branch }, state: 'Available' };
      current = [...current, created];
      state = 'Available';
      return created;
    },
    async startCodespace(name) {
      calls.start++;
      state = 'Available';
      current = current.map(item => item.name === name ? { ...item, state } : item);
    },
    async stopCodespace(name) {
      calls.stop++;
      state = 'Shutdown';
      current = current.map(item => item.name === name ? { ...item, state } : item);
    }
  };
}

test('parses common GitHub HTTPS and SSH remotes without returning credentials', () => {
  assert.equal(parseGitHubRepository('https://github.com/octocat/hello-world.git'), 'octocat/hello-world');
  assert.equal(parseGitHubRepository('git@github.com:Octocat/hello-world.git'), 'Octocat/hello-world');
  assert.equal(parseGitHubRepository('ssh://git@github.com/octocat/hello-world'), 'octocat/hello-world');
  assert.equal(parseGitHubRepository('https://private-token@github.com/octocat/hello-world.git'), 'octocat/hello-world');
  assert.equal(parseGitHubRepository('https://github.example.com/octocat/hello-world.git'), null);
  assert.equal(parseGitHubRepository('not a remote'), null);
});

test('detects GitHub repository and branch from the local Git checkout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codespaces-mcp-git-'));
  try {
    execFileSync('git', ['init', '-b', 'feature/mcp-test', directory], { stdio: 'ignore' });
    execFileSync('git', ['-C', directory, 'remote', 'add', 'origin', 'git@github.com:octocat/hello-world.git'], { stdio: 'ignore' });
    assert.deepEqual(await detectRepositoryContext({ cwd: directory }), {
      repository: 'octocat/hello-world',
      branch: 'feature/mcp-test',
      cwd: directory,
      remoteName: 'origin'
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('selects only an exact repository and branch match', () => {
  const codespaces = [
    { name: 'other-repo', repository: 'octocat/other', gitStatus: { ref: 'feature/test' } },
    { name: 'other-branch', repository: 'octocat/hello-world', gitStatus: { ref: 'main' } },
    { name: 'exact', repository: { full_name: 'Octocat/Hello-World' }, gitStatus: { ref: 'refs/heads/feature/test' } }
  ];
  assert.equal(findMatchingCodespace(codespaces, 'octocat/hello-world', 'feature/test').name, 'exact');
  assert.equal(findMatchingCodespace(codespaces, 'octocat/hello-world', 'feature/other'), null);
});

test('reuses an already available Codespace and leaves its lifecycle unchanged', async () => {
  const gh = fakeGh({ codespaces: [{ name: 'octocat-running', repository: 'octocat/hello-world', gitStatus: { ref: 'feature/test' }, state: 'Available' }] });
  const manager = createCodespaceManager({
    gh,
    detectContext: async () => context(),
    lock: async (_key, operation) => operation(),
    runCommand: async () => ({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, outputTruncated: false })
  });
  const result = await manager.runRepositoryCommand({ command: 'npm test' });
  assert.equal(result.codespaceName, 'octocat-running');
  assert.equal(result.created, false);
  assert.equal(result.started, false);
  assert.equal(result.stoppedAfterRun, false);
  assert.deepEqual(gh.calls, { list: 1, create: 0, start: 0, stop: 0 });
});

test('starts a matching stopped Codespace and stops it after the command', async () => {
  const gh = fakeGh({ codespaces: [{ name: 'octocat-stopped', repository: 'octocat/hello-world', gitStatus: { ref: 'feature/test' }, state: 'Shutdown' }], state: 'Shutdown' });
  const manager = createCodespaceManager({
    gh,
    detectContext: async () => context(),
    lock: async (_key, operation) => operation(),
    runCommand: async () => ({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, outputTruncated: false }),
    sleep: async () => {},
    startupTimeoutMs: 1_000
  });
  const result = await manager.runRepositoryCommand({ command: 'npm test' });
  assert.equal(result.started, true);
  assert.equal(result.stoppedAfterRun, true);
  assert.equal(gh.calls.start, 1);
  assert.equal(gh.calls.stop, 1);
});

test('stops a Codespace it started even when the remote command exits nonzero', async () => {
  const gh = fakeGh({ codespaces: [{ name: 'octocat-stopped', repository: 'octocat/hello-world', gitStatus: { ref: 'feature/test' }, state: 'Shutdown' }], state: 'Shutdown' });
  const manager = createCodespaceManager({
    gh,
    detectContext: async () => context(),
    lock: async (_key, operation) => operation(),
    runCommand: async () => ({ exitCode: 2, stdout: '', stderr: 'failed', timedOut: false, outputTruncated: false }),
    sleep: async () => {},
    startupTimeoutMs: 1_000
  });
  const result = await manager.runRepositoryCommand({ command: 'npm test' });
  assert.equal(result.result.exitCode, 2);
  assert.equal(result.stoppedAfterRun, true);
  assert.equal(gh.calls.stop, 1);
});

test('creates a Codespace only after an exact repo/branch match is absent', async () => {
  const gh = fakeGh({ codespaces: [{ name: 'different-branch', repository: 'octocat/hello-world', gitStatus: { ref: 'main' }, state: 'Available' }] });
  const manager = createCodespaceManager({
    gh,
    detectContext: async () => context(),
    lock: async (_key, operation) => operation(),
    runCommand: async () => ({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, outputTruncated: false }),
    startupTimeoutMs: 1_000
  });
  const result = await manager.runRepositoryCommand({ command: 'npm test' });
  assert.equal(result.created, true);
  assert.equal(result.codespaceName, 'octocat-new-space');
  assert.equal(result.stoppedAfterRun, true);
  assert.equal(gh.calls.create, 1);
  assert.equal(gh.calls.stop, 1);
});

test('validates repository commands and timeouts before Codespace lifecycle calls', async () => {
  const gh = fakeGh();
  let detectCalls = 0;
  const manager = createCodespaceManager({
    gh,
    detectContext: async () => { detectCalls++; return context(); },
    lock: async (_key, operation) => operation(),
    runCommand: async ({ codespaceName, command, timeoutMs }) => {
      validateRunInput({ codespaceName: codespaceName || 'octocat-space', command, timeoutMs });
      return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, outputTruncated: false };
    },
    startupTimeoutMs: 1_000
  });

  await assert.rejects(manager.runRepositoryCommand({ command: '  ' }), /non-empty script/);
  await assert.rejects(manager.runRepositoryCommand({ command: 'npm test', timeoutMs: 999 }), /timeoutMs/);
  assert.equal(detectCalls, 0);
  assert.deepEqual(gh.calls, { list: 0, create: 0, start: 0, stop: 0 });
});

test('serializes concurrent requests across server processes to prevent duplicate creation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codespaces-mcp-lock-'));
  const gh = fakeGh();
  const common = {
    gh,
    detectContext: async () => context(),
    lock: (key, operation) => withRepositoryLock(key, operation, { directory, pollIntervalMs: 10, timeoutMs: 2_000 }),
    runCommand: async () => {
      await new Promise(resolve => setTimeout(resolve, 35));
      return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, outputTruncated: false };
    },
    startupTimeoutMs: 1_000
  };
  try {
    const first = createCodespaceManager(common);
    const second = createCodespaceManager(common);
    const results = await Promise.all([
      first.runRepositoryCommand({ command: 'npm test' }),
      second.runRepositoryCommand({ command: 'npm run check' })
    ]);
    assert.equal(gh.calls.create, 1);
    assert.equal(results[0].codespaceName, results[1].codespaceName);
    assert.deepEqual(results.map(result => result.created).sort(), [false, true]);
    assert.equal(gh.calls.start, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
