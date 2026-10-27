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

test('surfaces a sanitized failure on nonzero GitHub CLI exit', async () => {
  const process = fakeProcess([{ exitCode: 1, stdout: '', stderr: 'authentication failed', timedOut: false, outputTruncated: false }]);
  const gh = createGhClient({ runProcessImpl: process.run });
  await assert.rejects(gh.listCodespaces(), /gh codespace list failed with exit code 1: authentication failed/);
});
