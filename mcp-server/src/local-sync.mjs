import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { runProcess } from './process-runner.mjs';

const MAX_PATCH_BYTES = 5 * 1024 * 1024;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const HEAD_RE = /^[a-f0-9]{40,64}$/i;
const RUN_ID_RE = /^[a-f0-9-]{36}$/i;

async function runGit(args, cwd, runProcessImpl, maxOutputChars = MAX_PATCH_BYTES) {
  const result = await runProcessImpl('git', args, { cwd, timeoutMs: 60_000, maxOutputChars });
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed (exit code ${result.exitCode}).`);
  if (result.outputTruncated || Buffer.byteLength(result.stdout) > maxOutputChars) throw new Error('Local changes exceed the 5 MiB transfer limit.');
  return result.stdout;
}

async function changedTrackedSubmodules(root, changedPaths, runProcessImpl) {
  if (changedPaths.length === 0) return [];
  const entries = await runGit(['ls-files', '--stage', '-z'], root, runProcessImpl);
  const gitlinks = new Set();
  for (const entry of entries.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    if (tab < 0 || entry.slice(0, tab).split(' ')[0] !== '160000') continue;
    gitlinks.add(entry.slice(tab + 1));
  }
  return changedPaths.filter(filename => gitlinks.has(filename));
}

async function nestedRepositoryFiles(root, repositoryRoot, runProcessImpl, pathBudget) {
  try {
    await lstat(join(repositoryRoot, '.git'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Could not snapshot an untracked nested Git repository.');
    throw error;
  }
  const remainingPathBytes = pathBudget.remaining();
  if (remainingPathBytes <= 0) throw new Error('Local changes exceed the 5 MiB transfer limit.');
  const output = await runGit(
    ['-C', repositoryRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    root,
    runProcessImpl,
    remainingPathBytes
  );
  const files = [];
  for (const entry of output.split('\0').filter(Boolean)) {
    const filename = join(repositoryRoot, entry);
    let info;
    try {
      info = await lstat(filename);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const relativeFilename = relative(root, filename).split(sep).join('/');
    pathBudget.add(relativeFilename);
    if (info.isDirectory()) {
      try {
        await lstat(join(filename, '.git'));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      files.push(...await nestedRepositoryFiles(root, filename, runProcessImpl, pathBudget));
      continue;
    }
    files.push(relativeFilename);
  }
  return files;
}

async function ignoredNestedPaths(root, filenames, runProcessImpl) {
  const result = await runProcessImpl('git', ['check-ignore', '--no-index', '-z', '--stdin'], {
    cwd: root,
    input: `${filenames.join('\0')}\0`,
    timeoutMs: 60_000,
    maxOutputChars: MAX_PATCH_BYTES
  });
  if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(`git check-ignore failed (exit code ${result.exitCode}).`);
  if (result.outputTruncated || Buffer.byteLength(result.stdout) > MAX_PATCH_BYTES) throw new Error('Local changes exceed the 5 MiB transfer limit.');
  return new Set(result.stdout.split('\0').filter(Boolean));
}

/** Snapshot tracked edits (staged and unstaged) plus non-ignored untracked files as a binary-safe Git patch. */
export async function buildLocalPatch(cwd, { runProcessImpl = runProcess } = {}) {
  const root = (await runGit(['rev-parse', '--show-toplevel'], cwd, runProcessImpl, 10_000)).trim();
  const head = (await runGit(['rev-parse', 'HEAD'], root, runProcessImpl, 10_000)).trim();
  if (!HEAD_RE.test(head)) throw new Error('Could not identify the local repository HEAD commit.');

  let patch = await runGit(['diff', '--binary', '--no-textconv', '--ignore-submodules=none', 'HEAD'], root, runProcessImpl);
  const tracked = (await runGit(['diff', '--name-only', '--ignore-submodules=none', '-z', 'HEAD'], root, runProcessImpl, MAX_PATCH_BYTES))
    .split('\0').filter(Boolean);
  if ((await changedTrackedSubmodules(root, tracked, runProcessImpl)).length > 0) {
    throw new Error('Local changes to tracked submodules cannot be synced safely.');
  }
  const untracked = (await runGit(['ls-files', '--others', '--exclude-standard', '-z'], root, runProcessImpl, MAX_PATCH_BYTES))
    .split('\0').filter(Boolean);
  const untrackedPaths = [];
  const nestedPaths = [];
  const pathBudget = {
    bytes: 0,
    add(filename) {
      this.bytes += Buffer.byteLength(filename) + 1;
      if (this.bytes > MAX_PATCH_BYTES) throw new Error('Local changes exceed the 5 MiB transfer limit.');
    },
    remaining() { return MAX_PATCH_BYTES - this.bytes; }
  };
  for (const filename of untracked) {
    if (filename.endsWith('/')) {
      pathBudget.add(filename);
      const nestedFiles = await nestedRepositoryFiles(root, join(root, filename.slice(0, -1)), runProcessImpl, pathBudget);
      nestedPaths.push(...nestedFiles);
      untrackedPaths.push(...nestedFiles);
    } else {
      pathBudget.add(filename);
      untrackedPaths.push(filename);
    }
  }
  const ignoredNested = nestedPaths.length ? await ignoredNestedPaths(root, nestedPaths, runProcessImpl) : new Set();
  const includedUntrackedPaths = untrackedPaths.filter(filename => !ignoredNested.has(filename));
  for (const filename of includedUntrackedPaths) {
    const remaining = MAX_PATCH_BYTES - Buffer.byteLength(patch);
    if (remaining <= 0) throw new Error('Local changes exceed the 5 MiB transfer limit.');
    const result = await runProcessImpl('git', ['diff', '--no-index', '--binary', '--no-textconv', '--', '/dev/null', filename], {
      cwd: root,
      timeoutMs: 60_000,
      maxOutputChars: remaining
    });
    // git diff --no-index returns 1 when it found the expected new-file diff.
    if (result.exitCode !== 1 && result.exitCode !== 0) throw new Error(`git diff failed for an untracked file (exit code ${result.exitCode}).`);
    if (result.outputTruncated || Buffer.byteLength(result.stdout) > remaining) throw new Error('Local changes exceed the 5 MiB transfer limit.');
    patch += result.stdout;
  }
  if (Buffer.byteLength(patch) > MAX_PATCH_BYTES) throw new Error('Local changes exceed the 5 MiB transfer limit.');
  return {
    root,
    head,
    patch,
    files: [...new Set([...tracked, ...includedUntrackedPaths])].sort(),
    untrackedFiles: [...new Set(includedUntrackedPaths)].sort(),
    patchBytes: Buffer.byteLength(patch),
    trackedAndUntrackedChanged: patch.length > 0
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Build a POSIX remote script that applies the patch in a detached temporary worktree and always cleans it up. */
export function buildRemoteWorktreeCommand({ repository, head, command, runId = randomUUID(), workspaceRoot = '/workspaces' }) {
  if (!REPOSITORY_RE.test(repository)) throw new TypeError('repository must use owner/repository format.');
  if (!HEAD_RE.test(head)) throw new TypeError('head must be a full Git commit id.');
  if (!RUN_ID_RE.test(runId)) throw new TypeError('runId must be a UUID.');
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.startsWith('/') || workspaceRoot.includes('\0')) {
    throw new TypeError('workspaceRoot must be an absolute path.');
  }
  if (typeof command !== 'string' || command.trim().length === 0 || command.length > 65_536) {
    throw new TypeError('command must be a non-empty script of at most 65536 characters.');
  }

  return `set -eu
umask 077
repo=${shellQuote(repository.toLowerCase())}
expected_head=${shellQuote(head)}
run_id=${shellQuote(runId)}
repo_root=''
repository_seen=0
for candidate in ${shellQuote(workspaceRoot)}/*; do
  [ -d "$candidate" ] || continue
  root=$(git -C "$candidate" rev-parse --show-toplevel 2>/dev/null) || continue
  remote=$(git -C "$root" remote get-url origin 2>/dev/null) || continue
  remote_lc=$(printf '%s' "$remote" | tr '[:upper:]' '[:lower:]')
  case "$remote_lc" in
    git@github.com:"$repo".git|git@github.com:"$repo"|https://github.com/"$repo".git|https://github.com/"$repo"|ssh://git@github.com/"$repo".git|ssh://git@github.com/"$repo"|ssh://github.com/"$repo".git|ssh://github.com/"$repo"|git://github.com/"$repo".git|git://github.com/"$repo")
      repository_seen=1
      candidate_head=$(git -C "$root" rev-parse HEAD 2>/dev/null) || continue
      if [ "$candidate_head" = "$expected_head" ]; then repo_root="$root"; break; fi
      ;;
  esac
done
if [ -z "$repo_root" ]; then
  if [ "$repository_seen" -eq 1 ]; then
    echo 'No matching repository checkout has the expected HEAD; refusing to apply local changes.' >&2
    exit 45
  fi
  echo 'Could not find the matching repository under /workspaces.' >&2
  exit 44
fi
actual_head=$(git -C "$repo_root" rev-parse HEAD)
[ "$actual_head" = "$expected_head" ] || { echo 'Codespace HEAD differs from the local HEAD; refusing to apply local changes.' >&2; exit 45; }
worktree="/tmp/antigravity-codespaces-mcp-$run_id"
patch_file="/tmp/antigravity-codespaces-mcp-$run_id.patch"
user_command=${shellQuote(command)}
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ -n "$repo_root" ] && [ -n "$worktree" ]; then git -C "$repo_root" worktree remove --force "$worktree" >/dev/null 2>&1 || true; fi
  rm -f "$patch_file"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM
git -C "$repo_root" worktree add --detach "$worktree" HEAD >/dev/null
cat > "$patch_file"
if [ -s "$patch_file" ]; then git -C "$worktree" apply --binary "$patch_file"; fi
rm -f "$patch_file"
cd "$worktree"
sh -c "$user_command"
`;
}

export const localSyncLimits = Object.freeze({ maxPatchBytes: MAX_PATCH_BYTES });
