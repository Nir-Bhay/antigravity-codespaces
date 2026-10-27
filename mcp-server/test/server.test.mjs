import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { runCodespaceCommand, safeChildEnvironment } from '../src/process-runner.mjs';
import { createCodespacesMcpServer } from '../src/server.mjs';

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

test('filters standard secret-bearing environment variables before launching GitHub CLI', () => {
  assert.deepEqual(
    safeChildEnvironment({ PATH: '/usr/bin', HOME: '/home/user', GH_TOKEN: 'sentinel', API_SECRET: 'sentinel-2' }),
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
