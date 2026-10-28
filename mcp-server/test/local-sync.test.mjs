import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCodespaceManager } from '../src/codespace-manager.mjs';
import { buildLocalPatch, buildRemoteWorktreeCommand } from '../src/local-sync.mjs';

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'codespaces-mcp-local-sync-'));
  execFileSync('git', ['init', '-b', 'feature/sync', root], { stdio: 'ignore' });
  git(root, ['config', 'user.name', 'MCP Test']);
  git(root, ['config', 'user.email', 'mcp-test@example.invalid']);
  await writeFile(join(root, '.gitignore'), 'ignored.txt\n');
  await writeFile(join(root, 'tracked.txt'), 'base\n');
  git(root, ['add', '.gitignore', 'tracked.txt']);
  git(root, ['commit', '-m', 'base']);
  return root;
}

test('snapshots staged, unstaged, binary, and untracked changes while excluding ignored files', async () => {
  const root = await makeRepo();
  const remote = await mkdtemp(join(tmpdir(), 'codespaces-mcp-remote-copy-'));
  try {
    await writeFile(join(root, 'tracked.txt'), 'staged version\n');
    git(root, ['add', 'tracked.txt']);
    await writeFile(join(root, 'tracked.txt'), 'final unstaged version\n');
    await writeFile(join(root, 'new file.bin'), Buffer.from([0, 1, 2, 255]));
    await writeFile(join(root, 'ignored.txt'), 'ignored marker\n');

    const snapshot = await buildLocalPatch(root);
    assert.equal(snapshot.root, root);
    assert.equal(snapshot.head, git(root, ['rev-parse', 'HEAD']));
    assert.equal(snapshot.trackedAndUntrackedChanged, true);
    assert.deepEqual(snapshot.files, ['new file.bin', 'tracked.txt']);
    assert.deepEqual(snapshot.untrackedFiles, ['new file.bin']);
    assert.ok(snapshot.patchBytes > 0);
    assert.match(snapshot.patch, /tracked\.txt/);
    assert.match(snapshot.patch, /new file\.bin/);
    assert.doesNotMatch(snapshot.patch, /ignored\.txt/);

    execFileSync('git', ['clone', '-q', root, remote], { stdio: 'ignore' });
    const patchFile = join(remote, 'local.patch');
    await writeFile(patchFile, snapshot.patch);
    git(remote, ['apply', '--binary', patchFile]);
    assert.equal(await readFile(join(remote, 'tracked.txt'), 'utf8'), 'final unstaged version\n');
    assert.deepEqual(await readFile(join(remote, 'new file.bin')), Buffer.from([0, 1, 2, 255]));
    await assert.rejects(readFile(join(remote, 'ignored.txt')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  }
});

test('repository command sends opted-in local changes only to an isolated remote worktree', async () => {
  const root = await makeRepo();
  try {
    git(root, ['remote', 'add', 'origin', 'https://github.com/octocat/hello-world.git']);
    await writeFile(join(root, 'tracked.txt'), 'local change\n');
    await writeFile(join(root, 'new.txt'), 'untracked change\n');
    await writeFile(join(root, 'ignored.txt'), 'ignored private marker\n');
    let launched;
    const manager = createCodespaceManager({
      gh: {
        async listCodespaces() { return [{ name: 'existing-space', repository: 'octocat/hello-world', gitStatus: { ref: 'feature/sync' }, state: 'Available' }]; },
        async getCodespace(name) { return { name, state: 'Available' }; },
        async createCodespace() { throw new Error('must reuse matching Codespace'); },
        async startCodespace() { throw new Error('must not start an available Codespace'); },
        async stopCodespace() { throw new Error('must not stop a Codespace it did not start'); }
      },
      lock: async (_key, operation) => operation(),
      runCommand: async input => {
        launched = input;
        return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, outputTruncated: false };
      }
    });

    const preview = await manager.previewLocalChanges({ cwd: root });
    assert.deepEqual(preview.files, ['new.txt', 'tracked.txt']);
    assert.deepEqual(preview.untrackedFiles, ['new.txt']);
    assert.equal(preview.repository, 'octocat/hello-world');
    assert.equal(preview.branch, 'feature/sync');
    assert.equal(preview.codespaceProvisioningAttempted, false);

    const result = await manager.runRepositoryCommand({ cwd: root, command: 'npm test', syncLocalChanges: true, localChangesPreviewId: preview.previewId });
    assert.equal(result.localChangesSynced, true);
    assert.equal(launched.codespaceName, 'existing-space');
    assert.ok(launched.command.includes('git -C "$repo_root" worktree add --detach'));
    assert.ok(launched.command.includes('sh -c "$user_command"'));
    assert.match(launched.input, /tracked\.txt/);
    assert.match(launched.input, /new\.txt/);
    assert.doesNotMatch(launched.input, /ignored\.txt/);
    assert.doesNotMatch(launched.input, /ignored private marker/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects local changes added after preview before provisioning a Codespace', async () => {
  const root = await makeRepo();
  try {
    git(root, ['remote', 'add', 'origin', 'https://github.com/octocat/hello-world.git']);
    await writeFile(join(root, 'reviewed.txt'), 'reviewed change\n');
    let provisioningCalls = 0;
    const manager = createCodespaceManager({
      gh: {
        async listCodespaces() { provisioningCalls++; return []; },
        async getCodespace() { throw new Error('must reject before Codespace lookup'); },
        async createCodespace() { throw new Error('must reject before Codespace creation'); },
        async startCodespace() { throw new Error('must reject before Codespace start'); },
        async stopCodespace() { throw new Error('must not stop a Codespace'); }
      },
      lock: async (_key, operation) => operation(),
      runCommand: async () => { throw new Error('must reject before command execution'); }
    });

    const preview = await manager.previewLocalChanges({ cwd: root });
    await writeFile(join(root, 'private-after-preview.txt'), 'private file added after review\n');

    await assert.rejects(
      manager.runRepositoryCommand({
        cwd: root,
        command: 'npm test',
        syncLocalChanges: true,
        localChangesPreviewId: preview.previewId
      }),
      /changed since preview/
    );
    assert.equal(provisioningCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('builds a syntactically valid remote cleanup script using a detached worktree', () => {
  const script = buildRemoteWorktreeCommand({
    repository: 'Octocat/hello-world',
    head: 'a'.repeat(40),
    runId: '12345678-1234-4234-9234-123456789abc',
    command: "printf '%s\\n' 'local change'; npm test"
  });
  assert.ok(script.includes('git -C "$repo_root" worktree add --detach'));
  assert.ok(script.includes('worktree remove --force'));
  assert.ok(script.includes('sh -c "$user_command"'));
  const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('executes the remote setup locally to prove patch application and cleanup on success or failure', async () => {
  const root = await makeRepo();
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'codespaces mcp workspaces '));
  const remoteRepo = join(workspaceRoot, 'hello-world');
  try {
    git(root, ['remote', 'add', 'origin', 'https://github.com/octocat/hello-world.git']);
    await writeFile(join(root, 'tracked.txt'), 'patched tracked file\n');
    await writeFile(join(root, 'new.txt'), 'patched untracked file\n');
    const snapshot = await buildLocalPatch(root);
    execFileSync('git', ['clone', '-q', root, remoteRepo], { stdio: 'ignore' });
    git(remoteRepo, ['remote', 'set-url', 'origin', 'https://github.com/octocat/hello-world.git']);

    const script = buildRemoteWorktreeCommand({
      repository: 'octocat/hello-world', head: snapshot.head, command: 'cat tracked.txt new.txt', workspaceRoot
    });
    const result = spawnSync('bash', ['-c', script], { cwd: remoteRepo, input: snapshot.patch, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'patched tracked file\npatched untracked file\n');
    assert.equal(await readFile(join(remoteRepo, 'tracked.txt'), 'utf8'), 'base\n');
    await assert.rejects(readFile(join(remoteRepo, 'new.txt')));
    assert.equal(git(remoteRepo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 1);

    const failingScript = buildRemoteWorktreeCommand({
      repository: 'octocat/hello-world', head: snapshot.head, command: 'exit 17', workspaceRoot
    });
    const failure = spawnSync('bash', ['-c', failingScript], { cwd: remoteRepo, input: snapshot.patch, encoding: 'utf8' });
    assert.equal(failure.status, 17);
    assert.equal(git(remoteRepo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects malformed repo, commit id, and run id before building remote command', () => {
  const args = { repository: 'owner/repo;touch /tmp/x', head: 'a'.repeat(40), command: 'true' };
  assert.throws(() => buildRemoteWorktreeCommand(args), /owner\/repository/);
  assert.throws(() => buildRemoteWorktreeCommand({ ...args, repository: 'owner/repo', head: 'not-a-commit' }), /full Git commit id/);
  assert.throws(() => buildRemoteWorktreeCommand({ ...args, repository: 'owner/repo', runId: 'bad' }), /UUID/);
});
