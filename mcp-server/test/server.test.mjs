import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { createCodespaceManager } from '../src/codespace-manager.mjs';
import { createGhClient } from '../src/gh-client.mjs';
import { runCodespaceCommand, runProcess, safeChildEnvironment } from '../src/process-runner.mjs';
import { createCodespacesMcpServer, progressReporter } from '../src/server.mjs';

test('progress notification failures do not reject the completed command response', async () => {
  let notifications = 0;
  const reporter = progressReporter({
    mcpReq: {
      _meta: { progressToken: 'test-token' },
      async notify() {
        notifications++;
        throw new Error('progress transport unavailable');
      }
    }
  });

  reporter.onOutput('stdout', 'tests passed\n').catch(() => {});
  reporter.onOutput('stderr', 'build complete\n').catch(() => {});
  await assert.doesNotReject(reporter.flush());
  assert.equal(notifications, 1, 'stop sending progress after the transport fails');
});

function fakeChild({ stdout = '', stderr = '', code = 0, signal = null, delayMs = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = requestedSignal => {
    queueMicrotask(() => child.emit('close', null, requestedSignal));
    return true;
  };
  setTimeout(() => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    child.emit('close', code, signal);
  }, delayMs);
  return child;
}

test('runs gh codespace ssh with argument-safe local process invocation and captures output/exit code', async () => {
  let observed;
  const result = await runCodespaceCommand(
    { codespaceName: 'octocat-space-123', command: 'npm test', timeoutMs: 5_000 },
    {
      ghPath: '/usr/bin/gh',
      env: { GH_TOKEN: 'not-read-or-logged' },
      spawnImpl: (file, args, options) => {
        observed = { file, args, options };
        return fakeChild({ stdout: 'tests passed\n', stderr: 'notice\n', code: 7 });
      }
    }
  );

  assert.equal(observed.file, '/usr/bin/gh');
  assert.deepEqual(observed.args, ['codespace', 'ssh', '--codespace', 'octocat-space-123', '--', 'npm test']);
  assert.equal(observed.options.shell, undefined);
  assert.equal(observed.options.env.GH_TOKEN, undefined);
  assert.deepEqual(result, {
    exitCode: 7,
    signal: null,
    stdout: 'tests passed\n',
    stderr: 'notice\n',
    timedOut: false,
    outputTruncated: false
  });
});

test('pipes an opted-in local patch to the remote SSH command over stdin', async () => {
  let options;
  let received = '';
  const result = await runCodespaceCommand(
    { codespaceName: 'octocat-space', command: 'cat > /tmp/patch', input: 'binary-safe Git patch' },
    {
      spawnImpl: (_file, _args, spawnOptions) => {
        options = spawnOptions;
        const child = fakeChild({ stdout: 'applied' });
        child.stdin = new PassThrough();
        child.stdin.on('data', chunk => { received += chunk.toString(); });
        return child;
      }
    }
  );
  assert.equal(options.stdio[0], 'pipe');
  assert.equal(received, 'binary-safe Git patch');
  assert.equal(result.stdout, 'applied');
});

test('redacts credential values from remote output and progress, including tokens split across chunks', async () => {
  const token = `ghp_${'a'.repeat(36)}`;
  const jwt = `eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`;
  const updates = [];
  const result = await runCodespaceCommand(
    { codespaceName: 'octocat-space', command: 'run private command' },
    {
      onOutput: (stream, chunk) => updates.push([stream, chunk]),
      spawnImpl: () => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => true;
        setTimeout(() => {
          child.stdout.write(`GITHUB_TOKEN=ghp_${'a'.repeat(10)}`);
          child.stdout.write(`${'a'.repeat(26)}\nAuthorization: Bearer ${jwt}\n`);
          child.stdout.end();
          child.stderr.end();
          child.emit('close', 0, null);
        }, 0);
        return child;
      }
    }
  );
  assert.doesNotMatch(result.stdout, new RegExp(token));
  assert.doesNotMatch(result.stdout, new RegExp(jwt));
  assert.match(result.stdout, /GITHUB_TOKEN=.*REDACTED/);
  assert.ok(result.stdout.includes('Bearer [REDACTED TOKEN]'));
  assert.ok(updates.every(([, chunk]) => !chunk.includes(token) && !chunk.includes(jwt)));
});

test('injects a pinned token only into the local gh SSH environment, not arguments or output', async () => {
  const token = 'in-memory-pinned-identity';
  const progress = [];
  let observed;
  const result = await runCodespaceCommand(
    { codespaceName: 'octocat-space', command: 'npm test' },
    {
      identityToken: token,
      env: { PATH: '/usr/bin', GH_TOKEN: 'ambient-token', API_SECRET: 'other-secret' },
      onOutput: (stream, text) => progress.push([stream, text]),
      spawnImpl: (file, args, options) => {
        observed = { file, args, env: options.env };
        return fakeChild({ stdout: 'remote output\n' });
      }
    }
  );

  assert.equal(observed.env.GH_TOKEN, token);
  assert.equal(observed.env.API_SECRET, undefined);
  assert.deepEqual(observed.args, ['codespace', 'ssh', '--codespace', 'octocat-space', '--', 'npm test']);
  assert.doesNotMatch(JSON.stringify(observed.args), new RegExp(token));
  assert.doesNotMatch(result.stdout, new RegExp(token));
  assert.ok(progress.every(([, text]) => !text.includes(token)));
});

test('token capture mode suppresses output callbacks and keeps raw token output only in memory', async () => {
  const token = `ghp_${'a'.repeat(36)}`;
  const progress = [];
  const result = await runProcess('/usr/bin/gh', ['auth', 'token', '--hostname', 'github.com'], {
    suppressOutputCallbacks: true,
    captureSensitiveStdout: true,
    onOutput: (_stream, text) => progress.push(text),
    spawnImpl: () => fakeChild({ stdout: `${token}\n` })
  });
  assert.equal(result.stdout.trim(), token);
  assert.deepEqual(progress, []);
  assert.throws(() => runProcess('/usr/bin/gh', ['auth', 'token'], {
    captureSensitiveStdout: true,
    spawnImpl: () => fakeChild({ stdout: `${token}\n` })
  }), /requires output callbacks to be suppressed/);
});

test('filters standard secret-bearing environment variables before launching GitHub CLI', () => {
  assert.deepEqual(
    safeChildEnvironment({
      PATH: '/usr/bin',
      HOME: '/home/user',
      GH_TOKEN: 'sentinel',
      GH_ENTERPRISE_TOKEN: 'sentinel-2',
      API_SECRET: 'sentinel-3',
      DB_PASSWORD: 'sentinel-4',
      SIGNING_PRIVATE_KEY: 'sentinel-5'
    }),
    { PATH: '/usr/bin', HOME: '/home/user' }
  );
});

test('rejects invalid Codespace names, empty commands, and out-of-range timeouts before spawning', async () => {
  let spawned = false;
  const deps = { spawnImpl: () => { spawned = true; throw new Error('unexpected'); } };
  assert.throws(() => runCodespaceCommand({ codespaceName: 'name; touch /tmp/pwned', command: 'true' }, deps), /valid Codespace name/);
  assert.throws(() => runCodespaceCommand({ codespaceName: 'octocat-space', command: '  ' }, deps), /non-empty script/);
  assert.throws(() => runCodespaceCommand({ codespaceName: 'octocat-space', command: 'true', timeoutMs: 0 }, deps), /timeoutMs/);
  assert.equal(spawned, false);
});

test('bounds captured and streamed output per channel', async () => {
  const updates = [];
  const result = await runCodespaceCommand(
    { codespaceName: 'octocat-space', command: 'cat large.log' },
    {
      onOutput: (stream, chunk) => updates.push([stream, chunk.length]),
      spawnImpl: () => fakeChild({ stdout: `${'x'.repeat(199_999)}\n${'x'.repeat(10_000)}` })
    }
  );
  assert.equal(result.stdout.length, 200_000);
  assert.equal(result.outputTruncated, true);
  assert.equal(updates.reduce((sum, [, length]) => sum + length, 0), 200_000);
});

test('terminates a command at its timeout and reports exit code 124', async () => {
  let signal;
  const result = await runCodespaceCommand(
    { codespaceName: 'octocat-space', command: 'sleep 100', timeoutMs: 1_000 },
    { spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = value => { signal = value; queueMicrotask(() => child.emit('close', null, value)); return true; };
      return child;
    } }
  );
  assert.equal(signal, 'SIGTERM');
  assert.equal(result.exitCode, 124);
  assert.equal(result.timedOut, true);
});

test('serves a streaming run command tool and returns output and exit code over MCP', async () => {
  const progressUpdates = [];
  const server = createCodespacesMcpServer({
    runCommand: async (input, { onOutput }) => {
      assert.equal(input.codespaceName, 'octocat-space');
      assert.equal(input.command, 'npm test');
      await onOutput('stdout', 'test 1\n');
      await onOutput('stderr', 'building\n');
      return { exitCode: 0, signal: null, stdout: 'test 1\n', stderr: 'building\n', timedOut: false, outputTruncated: false };
    }
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const toolNames = listed.tools.map(tool => tool.name);
    assert.ok(toolNames.includes('check_setup'));
    assert.ok(toolNames.includes('preview_local_changes'));
    assert.ok(toolNames.includes('run_codespace_command'));
    assert.ok(toolNames.includes('run_repository_command'));
    assert.ok(toolNames.includes('list_codespaces'));
    assert.ok(toolNames.includes('start_codespace'));
    assert.ok(toolNames.includes('stop_codespace'));
    assert.ok(toolNames.includes('get_codespace_status'));
    assert.ok(toolNames.includes('get_codespace_logs'));
    assert.ok(toolNames.includes('get_codespace_ports'));
    assert.ok(!toolNames.some(name => name.includes('delete')));

    const result = await client.callTool(
      { name: 'run_codespace_command', arguments: { codespaceName: 'octocat-space', command: 'npm test' } },
      { onprogress: update => progressUpdates.push(update.message) }
    );
    assert.equal(result.isError, false);
    assert.match(result.content[0].text, /Exit code: 0/);
    assert.match(result.content[0].text, /STDOUT:\ntest 1/);
    assert.match(result.content[0].text, /STDERR:\nbuilding/);
    assert.ok(progressUpdates.some(message => message.includes('stdout: test 1')));
    assert.ok(progressUpdates.some(message => message.includes('stderr: building')));
  } finally {
    await client.close();
    await server.close();
  }
});

test('setup and sync-preview tools return safe read-only reports without remote lifecycle calls', async () => {
  const calls = [];
  const manager = {
    async preflightRepository() {
      calls.push('preflight');
      return { ready: true, codespaceProvisioningAttempted: false, checks: [] };
    },
    async previewLocalChanges() {
      calls.push('preview');
      return { files: ['src/app.js'], patchBytes: 42, codespaceProvisioningAttempted: false };
    }
  };
  const server = createCodespacesMcpServer({ manager });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const setup = await client.callTool({ name: 'check_setup', arguments: {} });
    const preview = await client.callTool({ name: 'preview_local_changes', arguments: {} });
    assert.equal(setup.isError, false);
    assert.match(setup.content[0].text, /codespaceProvisioningAttempted/);
    assert.equal(preview.isError, false);
    assert.match(preview.content[0].text, /src\/app\.js/);
    assert.doesNotMatch(preview.content[0].text, /patch content/i);
    assert.deepEqual(calls, ['preflight', 'preview']);
  } finally {
    await client.close();
    await server.close();
  }
});

test('run_repository_command reports detected repository, lifecycle, and streamed output', async () => {
  const progressUpdates = [];
  const manager = {
    runRepositoryCommand: async ({ command, onOutput }) => {
      assert.equal(command, 'npm test');
      await onOutput('stdout', 'tests passed\n');
      return {
        repository: 'octocat/repo', branch: 'feature/test', codespaceName: 'octocat-space',
        created: true, started: false, stoppedAfterRun: true, cleanupError: null,
        result: { exitCode: 0, stdout: 'tests passed\n', stderr: '', timedOut: false, outputTruncated: false }
      };
    }
  };
  const server = createCodespacesMcpServer({ manager });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool(
      { name: 'run_repository_command', arguments: { command: 'npm test' } },
      { onprogress: update => progressUpdates.push(update.message) }
    );
    assert.equal(result.isError, false);
    assert.ok(result.content[0].text.includes('Repository: octocat/repo'));
    assert.ok(result.content[0].text.includes('Branch: feature/test'));
    assert.match(result.content[0].text, /Created by server: yes/);
    assert.match(result.content[0].text, /Stopped after command: yes/);
    assert.match(result.content[0].text, /Exit code: 0/);
    assert.ok(progressUpdates.some(message => message.includes('stdout: tests passed')));
  } finally {
    await client.close();
    await server.close();
  }
});

test('starts as a real stdio server with protocol traffic isolated from stdout', async () => {
  const client = new Client({ name: 'stdio-smoke-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../index.mjs', import.meta.url))],
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stderr: 'pipe'
  });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    assert.ok(listed.tools.some(tool => tool.name === 'run_codespace_command'));
  } finally {
    await client.close();
  }
});

test('marks remote nonzero exits as MCP tool errors', async () => {
  const server = createCodespacesMcpServer({
    runCommand: async () => ({ exitCode: 23, signal: null, stdout: '', stderr: 'failed', timedOut: false, outputTruncated: false })
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({
      name: 'run_codespace_command',
      arguments: { codespaceName: 'octocat-space', command: 'false' }
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Exit code: 23/);
  } finally {
    await client.close();
    await server.close();
  }
});

test('MCP cancellation terminates the explicitly targeted Codespace SSH process', async () => {
  let child;
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  let resolveFinished;
  const finished = new Promise(resolve => { resolveFinished = resolve; });
  const server = createCodespacesMcpServer({
    runCommand: async (input, { signal, onOutput }) => {
      try {
        return await runCodespaceCommand(input, {
          signal,
          onOutput,
          spawnImpl: () => {
            child = new EventEmitter();
            child.stdout = new PassThrough();
            child.stderr = new PassThrough();
            child.killSignals = [];
            child.closed = false;
            child.finish = requestedSignal => {
              if (child.closed) return;
              child.closed = true;
              child.stdout.end();
              child.stderr.end();
              child.emit('close', null, requestedSignal);
            };
            child.kill = requestedSignal => {
              child.killSignals.push(requestedSignal);
              queueMicrotask(() => child.finish(requestedSignal));
              return true;
            };
            resolveStarted();
            return child;
          }
        });
      } finally {
        resolveFinished();
      }
    }
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'cancel-test-client', version: '1.0.0' });
  const controller = new AbortController();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const request = client.callTool(
      { name: 'run_codespace_command', arguments: { codespaceName: 'octocat-space', command: 'sleep 3600', timeoutMs: 60_000 } },
      { signal: controller.signal }
    );
    await started;
    controller.abort(new Error('test cancellation'));
    await assert.rejects(request);
    assert.deepEqual(child.killSignals, ['SIGTERM']);
    await finished;
  } finally {
    child?.finish('SIGKILL');
    await finished;
    await client.close();
    await server.close();
  }
});

test('MCP cancellation reaches Codespace lifecycle tool handlers', async () => {
  const lifecycleCalls = [
    { tool: 'list_codespaces', args: {}, method: 'listCodespaces' },
    { tool: 'get_codespace_status', args: { codespaceName: 'octocat-space' }, method: 'getCodespace' },
    { tool: 'start_codespace', args: { codespaceName: 'octocat-space' }, method: 'startCodespace' },
    { tool: 'stop_codespace', args: { codespaceName: 'octocat-space' }, method: 'stopCodespace' },
    { tool: 'get_codespace_logs', args: { codespaceName: 'octocat-space' }, method: 'getCodespaceLogs' },
    { tool: 'get_codespace_ports', args: { codespaceName: 'octocat-space' }, method: 'getCodespacePorts' }
  ];
  let probe;
  const waitForAbort = async signal => {
    probe.signal = signal;
    probe.started();
    let timer;
    const aborted = await new Promise(resolve => {
      timer = setTimeout(() => resolve(false), 100);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve(true);
      }, { once: true });
    });
    return aborted;
  };
  const manager = Object.fromEntries(lifecycleCalls.map(({ method }) => [method, async (...args) => {
    const options = typeof args[0] === 'string' ? args[1] : args[0];
    try { return await waitForAbort(options?.signal); }
    finally { probe.finished(); }
  }]));
  const server = createCodespacesMcpServer({ manager });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'lifecycle-cancel-test-client', version: '1.0.0' });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    for (const { tool, args } of lifecycleCalls) {
      let resolveStarted;
      let resolveFinished;
      const started = new Promise(resolve => { resolveStarted = resolve; });
      const finished = new Promise(resolve => { resolveFinished = resolve; });
      probe = { signal: null, started: resolveStarted, finished: resolveFinished };
      const controller = new AbortController();
      const request = client.callTool({ name: tool, arguments: args }, { signal: controller.signal });
      await started;
      controller.abort(new Error('test lifecycle cancellation'));
      await assert.rejects(request);
      assert.equal(await finished.then(() => true), true);
      assert.equal(probe.signal?.aborted, true, `${tool} receives the MCP request signal`);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test('MCP cancellation aborts repository provisioning and keeps owned-Codespace cleanup independent', async () => {
  let resolveStatusStarted;
  const statusStarted = new Promise(resolve => { resolveStatusStarted = resolve; });
  let resolveCleanupFinished;
  const cleanupFinished = new Promise(resolve => { resolveCleanupFinished = resolve; });
  let resolveManagerFinished;
  const managerFinished = new Promise(resolve => { resolveManagerFinished = resolve; });
  let statusSignal;
  let cleanupSignal = 'not-called';
  const gh = createGhClient({
    runProcessImpl: async (_file, args, options) => {
      if (args[0] === 'auth') return { exitCode: 0, stdout: 'test-token', stderr: '', timedOut: false, outputTruncated: false };
      if (args[0] === 'codespace' && args[1] === 'list') return { exitCode: 0, stdout: '[]', stderr: '', timedOut: false, outputTruncated: false };
      if (args[0] === 'api' && args[1] === 'repos/octocat/hello-world') return { exitCode: 0, stdout: '12345', stderr: '', timedOut: false, outputTruncated: false };
      if (args[0] === 'api' && args[1] === '-X' && args[2] === 'POST') {
        return { exitCode: 0, stdout: '{"name":"octocat-created-space","state":"Starting"}', stderr: '', timedOut: false, outputTruncated: false };
      }
      if (args[0] === 'api' && args[1] === '/user/codespaces/octocat-created-space') {
        statusSignal = options.signal;
        resolveStatusStarted();
        return new Promise((_, reject) => {
          const onAbort = () => {
            options.signal.removeEventListener('abort', onAbort);
            const error = new Error('Process was cancelled.');
            error.name = 'AbortError';
            reject(error);
          };
          if (options.signal?.aborted) onAbort();
          else options.signal?.addEventListener('abort', onAbort, { once: true });
        });
      }
      if (args[0] === 'codespace' && args[1] === 'stop') {
        cleanupSignal = options.signal;
        resolveCleanupFinished();
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false, outputTruncated: false };
      }
      throw new Error(`Unexpected fake gh invocation: ${args.join(' ')}`);
    }
  });
  const manager = createCodespaceManager({
    gh,
    detectContext: async () => ({ repository: 'octocat/hello-world', branch: 'feature/cancel-setup', cwd: '/tmp/repo' }),
    lock: async (_key, operation) => operation(),
    runCommand: async () => { throw new Error('the remote command must not start before provisioning finishes'); }
  });
  const runRepositoryCommand = manager.runRepositoryCommand.bind(manager);
  manager.runRepositoryCommand = async options => {
    try { return await runRepositoryCommand(options); }
    finally { resolveManagerFinished(); }
  };
  const server = createCodespacesMcpServer({ manager });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'cancel-setup-test-client', version: '1.0.0' });
  const controller = new AbortController();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const request = client.callTool(
      { name: 'run_repository_command', arguments: { command: 'npm test' } },
      { signal: controller.signal }
    );
    await statusStarted;
    assert.ok(statusSignal, 'the status process receives a cancellation signal');
    controller.abort(new Error('test provisioning cancellation'));
    await assert.rejects(request);
    await cleanupFinished;
    await managerFinished;
    assert.equal(statusSignal.aborted, true, 'the in-flight status process is cancelled');
    assert.equal(cleanupSignal, undefined, 'cleanup must not inherit the cancelled request signal');
  } finally {
    await client.close();
    await server.close();
  }
});

test('MCP cancellation stops a Codespace created for a repository command', async () => {
  let child;
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  let resolveFinished;
  const finished = new Promise(resolve => { resolveFinished = resolve; });
  let resolveStopped;
  const stopped = new Promise(resolve => { resolveStopped = resolve; });
  let stopCalls = 0;
  const runCommand = async (input, { signal, onOutput }) => {
    try {
      return await runCodespaceCommand(input, {
        signal,
        onOutput,
        spawnImpl: () => {
          child = new EventEmitter();
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          child.killSignals = [];
          child.closed = false;
          child.finish = requestedSignal => {
            if (child.closed) return;
            child.closed = true;
            child.stdout.end();
            child.stderr.end();
            child.emit('close', null, requestedSignal);
          };
          child.kill = requestedSignal => {
            child.killSignals.push(requestedSignal);
            queueMicrotask(() => child.finish(requestedSignal));
            return true;
          };
          resolveStarted();
          return child;
        }
      });
    } finally {
      resolveFinished();
    }
  };
  const manager = createCodespaceManager({
    gh: {
      async listCodespaces() { return []; },
      async createCodespace(repository, branch) {
        return { name: 'octocat-created-space', repository, gitStatus: { ref: branch }, state: 'Available' };
      },
      async getCodespace(name) { return { name, state: 'Available' }; },
      async stopCodespace() { stopCalls++; resolveStopped(); }
    },
    detectContext: async () => ({ repository: 'octocat/hello-world', branch: 'feature/cancel', cwd: '/tmp/repo' }),
    lock: async (_key, operation) => operation(),
    runCommand
  });
  const server = createCodespacesMcpServer({ manager });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'cancel-test-client', version: '1.0.0' });
  const controller = new AbortController();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const request = client.callTool(
      { name: 'run_repository_command', arguments: { command: 'sleep 3600', timeoutMs: 60_000 } },
      { signal: controller.signal }
    );
    await started;
    controller.abort(new Error('test cancellation'));
    await assert.rejects(request);
    assert.deepEqual(child.killSignals, ['SIGTERM']);
    await finished;
    await stopped;
    assert.equal(stopCalls, 1);
  } finally {
    child?.finish('SIGKILL');
    await finished;
    await client.close();
    await server.close();
  }
});
