import assert from 'node:assert/strict';
import test from 'node:test';
import { runPreflight } from '../src/preflight.mjs';

const repository = async () => ({ repository: 'octocat/hello-world', branch: 'main' });

test('preflight reports a ready local setup and confirms it never provisions a Codespace', async () => {
  const calls = [];
  const result = await runPreflight({
    detectContext: repository,
    runProcessImpl: async (_command, args) => {
      calls.push(args);
      if (args[0] === '--version') return { exitCode: 0, stdout: 'gh version 2.50.0', stderr: '' };
      return { exitCode: 0, stdout: "Logged in to github.com\nToken scopes: 'codespace', 'repo'", stderr: '' };
    }
  });
  assert.equal(result.ready, true);
  assert.equal(result.codespaceProvisioningAttempted, false);
  assert.equal(result.checks.find(check => check.name === 'Codespaces permission').ok, true);
  assert.deepEqual(calls, [['--version'], ['auth', 'status', '--hostname', 'github.com']]);
});

test('preflight gives actionable missing-scope/auth guidance without calling GitHub Codespaces APIs', async () => {
  const result = await runPreflight({
    detectContext: async () => { throw new Error('No GitHub.com repository remote was found.'); },
    runProcessImpl: async (_command, args) => args[0] === '--version'
      ? { exitCode: 0, stdout: 'gh version 2.50.0', stderr: '' }
      : { exitCode: 0, stdout: "Logged in to github.com\nToken scopes: 'repo'", stderr: '' }
  });
  assert.equal(result.ready, false);
  assert.match(result.checks.find(check => check.name === 'Codespaces permission').detail, /gh auth refresh.*codespace/);
  assert.match(result.checks.find(check => check.name === 'GitHub repository and branch').detail, /No GitHub.com repository remote/);
  assert.equal(result.codespaceProvisioningAttempted, false);
});

test('preflight distinguishes missing gh and unauthenticated state, including spawn errors', async () => {
  const result = await runPreflight({
    detectContext: repository,
    runProcessImpl: async () => { throw new Error('spawn gh ENOENT'); }
  });
  assert.equal(result.ready, false);
  assert.match(result.checks.find(check => check.name === 'GitHub CLI').detail, /install gh/);
  assert.match(result.checks.find(check => check.name === 'GitHub CLI authentication').detail, /Install gh/);
});
