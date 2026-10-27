import { runProcess } from './process-runner.mjs';

const REPO_PART_RE = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubRepository(remoteUrl) {
  if (typeof remoteUrl !== 'string' || !remoteUrl.trim()) return null;
  const value = remoteUrl.trim();
  let host;
  let pathname;
  try {
    if (/^[^/]+@[^:]+:.+$/.test(value) && !value.includes('://')) {
      const match = value.match(/^[^@]+@([^:]+):(.+)$/);
      host = match?.[1];
      pathname = match?.[2];
    } else {
      const url = new URL(value);
      host = url.hostname;
      pathname = url.pathname;
    }
  } catch {
    return null;
  }
  if (host?.toLowerCase() !== 'github.com') return null;
  const parts = String(pathname || '').replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
  if (parts.length !== 2 || !parts.every(part => REPO_PART_RE.test(part))) return null;
  return `${parts[0]}/${parts[1]}`;
}

async function runGit(args, cwd, runProcessImpl) {
  const result = await runProcessImpl('git', args, { cwd, timeoutMs: 10_000 });
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed (exit code ${result.exitCode}).`);
  return result.stdout.trim();
}

export async function detectRepositoryContext({ cwd = process.cwd(), runProcessImpl = runProcess } = {}) {
  const root = await runGit(['rev-parse', '--show-toplevel'], cwd, runProcessImpl);
  const branch = await runGit(['branch', '--show-current'], root, runProcessImpl);
  if (!branch) throw new Error('The local repository is in detached-HEAD state; check out a branch before using Codespaces remote execution.');

  const remoteNames = (await runGit(['remote'], root, runProcessImpl)).split(/\r?\n/).filter(Boolean);
  const orderedRemotes = [...remoteNames].sort((a, b) => (a === 'origin' ? -1 : b === 'origin' ? 1 : a.localeCompare(b)));
  for (const remoteName of orderedRemotes) {
    const remoteUrl = await runGit(['remote', 'get-url', remoteName], root, runProcessImpl);
    const repository = parseGitHubRepository(remoteUrl);
    if (repository) return { repository, branch, cwd: root, remoteName };
  }
  throw new Error('No GitHub.com repository remote was found in the local Git repository.');
}
