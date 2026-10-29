import assert from 'node:assert/strict';
import test from 'node:test';
import { createGhClient } from '../src/gh-client.mjs';

function fakeProcess(outputs) {
  const calls = [];
  return {
    calls,
    run: async (file, args, options) => {
      calls.push({ file, args, options });
      const next = outputs.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'object' ? next : { exitCode: 0, stdout: String(next), stderr: '', timedOut: false, outputTruncated: false };
    }
  };
}

test('pins the active GitHub.com token with a private capture call and fails closed', async () => {
  const calls = [];
  const secret = 'capture-only-token-value';
  const gh = createGhClient({
    ghPath: '/opt/gh',
    runProcessImpl: async (file, args, options) => {
      calls.push({ file, args, options });
      return { exitCode: 0, stdout: `${secret}\n`, stderr: '', timedOut: false, outputTruncated: false };
    }
  });

  assert.equal(await gh.pinIdentity(), secret);
  assert.deepEqual(calls[0].args, ['auth', 'token', '--hostname', 'github.com']);
  assert.equal(calls[0].options.suppressOutputCallbacks, true);
  assert.equal(typeof calls[0].options.onOutput, 'function');
  assert.equal(calls[0].options.githubCliToken, undefined);
  assert.doesNotMatch(JSON.stringify(calls[0].args), new RegExp(secret));

  const failed = createGhClient({
    runProcessImpl: async () => ({ exitCode: 1, stdout: secret, stderr: secret, timedOut: false, outputTruncated: false })
  });
  await assert.rejects(failed.pinIdentity(), error => {
    assert.match(error.message, /Could not pin the active GitHub CLI account/);
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  });

  for (const result of [
    { exitCode: 0, stdout: secret, stderr: '', timedOut: true, outputTruncated: false },
    { exitCode: 0, stdout: secret, stderr: '', timedOut: false, outputTruncated: true }
  ]) {
    const incomplete = createGhClient({ runProcessImpl: async () => result });
    await assert.rejects(incomplete.pinIdentity(), /Could not pin the active GitHub CLI account/);
  }
});

test('lists Codespaces via GitHub CLI JSON with a bounded explicit page limit', async () => {
  const process = fakeProcess(['[{"name":"space","state":"Available"}]']);
  const gh = createGhClient({ ghPath: '/opt/gh', runProcessImpl: process.run });
  const result = await gh.listCodespaces();
  assert.deepEqual(result, [{ name: 'space', state: 'Available' }]);
  assert.equal(process.calls[0].file, '/opt/gh');
  assert.deepEqual(process.calls[0].args, [
    'codespace', 'list', '--limit', '1000', '--json',
    'name,displayName,repository,gitStatus,state,lastUsedAt,machineName'
  ]);
});

test('creates a Codespace using repository id and ref without an interactive CLI prompt', async () => {
  const process = fakeProcess(['12345', '{"name":"octocat-new-space","state":"Available"}']);
  const gh = createGhClient({ runProcessImpl: process.run });
  const created = await gh.createCodespace('octocat/hello-world', 'feature/mcp');
  assert.equal(created.name, 'octocat-new-space');
  assert.deepEqual(process.calls.map(call => call.args), [
    ['api', 'repos/octocat/hello-world', '--jq', '.id'],
    ['api', '-X', 'POST', '/user/codespaces', '-F', 'repository_id=12345', '-F', 'ref=feature/mcp']
  ]);
});

test('validates repository names before any API call', async () => {
  const process = fakeProcess([]);
  const gh = createGhClient({ runProcessImpl: process.run });
  await assert.rejects(gh.createCodespace('octocat/hello-world; echo bad', 'main'), /owner\/repository/);
  assert.equal(process.calls.length, 0);
});

test('calls the documented start, stop, logs, ports, and status commands', async () => {
  const process = fakeProcess([
    '{"name":"space","state":"Shutdown"}',
    '{}',
    '',
    'logs',
    '[{"portNumber":3000,"forwardedUrl":"https://example.test"}]'
  ]);
  const gh = createGhClient({ runProcessImpl: process.run });
  assert.equal((await gh.getCodespace('space')).state, 'Shutdown');
  await gh.startCodespace('space');
  await gh.stopCodespace('space');
  assert.equal(await gh.getCodespaceLogs('space'), 'logs');
  assert.equal((await gh.getCodespacePorts('space'))[0].portNumber, 3000);
  assert.deepEqual(process.calls.map(call => call.args), [
    ['api', '/user/codespaces/space'],
    ['api', '-X', 'POST', '/user/codespaces/space/start'],
    ['codespace', 'stop', '--codespace', 'space'],
    ['codespace', 'logs', '--codespace', 'space'],
    ['codespace', 'ports', '--codespace', 'space', '--json', 'portNumber,protocol,visibility,forwardedUrl']
  ]);
});

test('maps rate limits, Codespaces quota errors, and start failures to actionable messages', async () => {
  const rateLimited = createGhClient({ runProcessImpl: fakeProcess([{
    exitCode: 1, stdout: '', stderr: 'HTTP 403: API rate limit exceeded', timedOut: false, outputTruncated: false
  }]).run });
  await assert.rejects(rateLimited.listCodespaces(), /GitHub API rate limit reached/);

  const overQuota = createGhClient({ runProcessImpl: fakeProcess([
    '12345',
    { exitCode: 1, stdout: '', stderr: 'Codespaces quota exceeded for this account', timedOut: false, outputTruncated: false }
  ]).run });
  await assert.rejects(overQuota.createCodespace('octocat/hello-world', 'main'), /Codespaces quota or billing limit/);

  const startFailed = createGhClient({ runProcessImpl: fakeProcess([{
    exitCode: 1, stdout: '', stderr: 'HTTP 409: Codespace failed to start', timedOut: false, outputTruncated: false
  }]).run });
  await assert.rejects(startFailed.startCodespace('octocat-space'), /Could not start Codespace octocat-space/);
});

test('preserves sanitized details for other GitHub CLI failures', async () => {
  const process = fakeProcess([{ exitCode: 1, stdout: '', stderr: 'authentication failed', timedOut: false, outputTruncated: false }]);
  const gh = createGhClient({ runProcessImpl: process.run });
  await assert.rejects(gh.listCodespaces(), /gh codespace list failed with exit code 1: authentication failed/);
});
