import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCodespaceManager, findMatchingCodespace, withRepositoryLock } from '../src/codespace-manager.mjs';
import { createGhClient } from '../src/gh-client.mjs';
import { validateRunInput } from '../src/process-runner.mjs';
import { detectRepositoryContext, parseGitHubRepository } from '../src/git-context.mjs';

function context(repository = 'octocat/hello-world', branch = 'feature/test') {
  return { repository, branch, cwd: '/tmp/repo' };
}

function fakeGh({ codespaces = [], state = 'Available', stopError = null } = {}) {
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
      if (stopError) throw stopError;
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

test('pins one GitHub identity through repository provisioning, polling, SSH and cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codespaces-mcp-identity-'));
  const firstToken = 'pinned-account-token';
  let activeToken = firstToken;
  const processCalls = [];
  const gh = createGhClient({
    runProcessImpl: async (_file, args, options) => {
      processCalls.push({ args, options });
      if (args[0] === 'auth') {
        const captured = activeToken;
        activeToken = 'switched-account-token';
        return { exitCode: 0, stdout: `${captured}\n`, stderr: '', timedOut: false, outputTruncated: false };
      }
      if (args[0] === 'codespace' && args[1] === 'list') {
        return { exitCode: 0, stdout: '[]', stderr: '', timedOut: false, outputTruncated: false };
      }
      if (args[0] === 'api' && args[1] === 'repos/octocat/hello-world') {
        return { exitCode: 0, stdout: '12345', stderr: '', timedOut: false, outputTruncated: false };
      }
      if (args[0] === 'api' && args[1] === '-X' && args[2] === 'POST') {
        return { exitCode: 0, stdout: '{"name":"octocat-created-space","state":"Starting"}', stderr: '', timedOut: false, outputTruncated: false };
      }
      if (args[0] === 'api' && args[1] === '/user/codespaces/octocat-created-space') {
        return { exitCode: 0, stdout: '{"name":"octocat-created-space","state":"Available"}', stderr: '', timedOut: false, outputTruncated: false };
      }
      if (args[0] === 'codespace' && args[1] === 'stop') {
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false, outputTruncated: false };
      }
      throw new Error(`Unexpected fake gh invocation: ${args.join(' ')}`);
    }
  });
  const manager = createCodespaceManager({
    gh,
    detectContext: async () => context(),
    lock: (key, operation) => withRepositoryLock(key, operation, { directory }),
    runCommand: async (input, { identityToken, onOutput }) => {
      assert.equal(identityToken, firstToken);
      assert.doesNotMatch(input.command, new RegExp(firstToken));
      const lockFiles = await readdir(directory);
      assert.equal(lockFiles.length, 1);
      const lockContents = await readFile(join(directory, lockFiles[0]), 'utf8');
      assert.doesNotMatch(lockContents, new RegExp(firstToken));
      await onOutput('stdout', 'remote command output\n');
      return { exitCode: 0, stdout: 'remote command output\n', stderr: '', timedOut: false, outputTruncated: false };
    },
    startupTimeoutMs: 1_000
  });
  const progress = [];
  try {
    const result = await manager.runRepositoryCommand({ command: 'npm test', onOutput: (stream, text) => progress.push([stream, text]) });
    assert.equal(result.codespaceName, 'octocat-created-space');
    assert.equal(result.created, true);
    assert.equal(result.stoppedAfterRun, true);
    assert.equal(activeToken, 'switched-account-token');
    assert.equal(processCalls.filter(call => call.args[0] === 'auth').length, 1);
    const lifecycleCalls = processCalls.filter(call => call.args[0] !== 'auth');
    assert.ok(lifecycleCalls.length >= 5);
    assert.ok(lifecycleCalls.every(call => call.options.githubCliToken === firstToken));
    assert.ok(processCalls.every(call => !call.args.includes(firstToken)));
    assert.ok(progress.every(([, text]) => !text.includes(firstToken)));
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pins one GitHub identity across an explicit Codespace start and availability poll', async () => {
  const firstToken = 'start-operation-token';
  let activeToken = firstToken;
  const processCalls = [];
  const gh = createGhClient({
    runProcessImpl: async (_file, args, options) => {
      processCalls.push({ args, options });
      if (args[0] === 'auth') {
        activeToken = 'changed-after-capture';
        return { exitCode: 0, stdout: `${firstToken}\n`, stderr: '', timedOut: false, outputTruncated: false };
      }
      if (args[0] === 'api' && args[1] === '/user/codespaces/octocat-space') {
        const state = args.length === 2 && processCalls.filter(call => call.args[0] === 'api' && call.args[1] === args[1]).length === 1
          ? 'Shutdown'
          : 'Available';
        return { exitCode: 0, stdout: JSON.stringify({ name: 'octocat-space', state }), stderr: '', timedOut: false, outputTruncated: false };
      }
      if (args[0] === 'api' && args[1] === '-X' && args[2] === 'POST') {
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false, outputTruncated: false };
      }
      throw new Error(`Unexpected fake gh invocation: ${args.join(' ')}`);
    }
  });
  const manager = createCodespaceManager({ gh, sleep: async () => {}, startupTimeoutMs: 1_000 });
  const status = await manager.startCodespace('octocat-space');
  assert.equal(status.state, 'Available');
  assert.equal(activeToken, 'changed-after-capture');
  assert.equal(processCalls.filter(call => call.args[0] === 'auth').length, 1);
  const lifecycleCalls = processCalls.filter(call => call.args[0] !== 'auth');
  assert.deepEqual(lifecycleCalls.map(call => call.options.githubCliToken), [firstToken, firstToken, firstToken]);
  assert.ok(processCalls.every(call => !call.args.includes(firstToken)));
});

test('does not call GitHub start when an explicit start sees a failed Codespace', async () => {
  const gh = fakeGh({ codespaces: [{ name: 'octocat-failed', repository: 'octocat/hello-world', gitStatus: { ref: 'feature/test' }, state: 'Failed' }], state: 'Failed' });
  const manager = createCodespaceManager({ gh });

  await assert.rejects(manager.startCodespace('octocat-failed'), /Cannot start Codespace octocat-failed while GitHub reports state "Failed"/);
  assert.equal(gh.calls.start, 0);
});

test('waits for an already starting Codespace without sending another start request', async () => {
  let statusReads = 0;
  let startCalls = 0;
  const gh = {
    async getCodespace(name) {
      statusReads++;
      return { name, state: statusReads === 1 ? 'Starting' : 'Available' };
    },
    async startCodespace() { startCalls++; }
  };
  const manager = createCodespaceManager({ gh, sleep: async () => {}, startupTimeoutMs: 1_000 });

  const status = await manager.startCodespace('octocat-starting');
  assert.equal(status.state, 'Available');
  assert.equal(startCalls, 0);
});

test('does not start or run a command in a failed matching Codespace', async () => {
  const gh = fakeGh({ codespaces: [{ name: 'octocat-failed', repository: 'octocat/hello-world', gitStatus: { ref: 'feature/test' }, state: 'Failed' }], state: 'Failed' });
  let commandCalls = 0;
  const manager = createCodespaceManager({
    gh,
    detectContext: async () => context(),
    lock: async (_key, operation) => operation(),
    runCommand: async () => { commandCalls++; return { exitCode: 0, stdout: '', stderr: '', timedOut: false, outputTruncated: false }; }
  });

  await assert.rejects(manager.runRepositoryCommand({ command: 'npm test' }), /Cannot start Codespace octocat-failed while GitHub reports state "Failed"/);
  assert.equal(gh.calls.start, 0);
  assert.equal(gh.calls.stop, 0);
  assert.equal(commandCalls, 0);
});

test('fails closed before lifecycle calls when the active token cannot be captured', async () => {
  const calls = [];
  const gh = createGhClient({
    runProcessImpl: async (_file, args) => {
      calls.push(args);
      return { exitCode: 1, stdout: 'sensitive-token-value', stderr: 'sensitive-token-value', timedOut: false, outputTruncated: false };
    }
  });
  const manager = createCodespaceManager({ gh });
  await assert.rejects(manager.startCodespace('octocat-space'), error => {
    assert.match(error.message, /Could not pin the active GitHub CLI account/);
    assert.doesNotMatch(error.message, /sensitive-token-value/);
    return true;
  });
  assert.deepEqual(calls, [['auth', 'token', '--hostname', 'github.com']]);
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

test('reports cleanup failure instead of claiming a started Codespace was stopped', async () => {
  const gh = fakeGh({
    codespaces: [{ name: 'octocat-stopped', repository: 'octocat/hello-world', gitStatus: { ref: 'feature/test' }, state: 'Shutdown' }],
    state: 'Shutdown',
    stopError: new Error('network unavailable')
  });
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
  assert.equal(result.stoppedAfterRun, false);
  assert.match(result.cleanupError, /network unavailable/);
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
