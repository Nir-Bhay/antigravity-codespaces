import { runProcess } from './process-runner.mjs';
import { detectRepositoryContext } from './git-context.mjs';

function scopesFromStatus(text) {
  const match = String(text).match(/token scopes:\s*([^\r\n]+)/i);
  return match ? [...match[1].matchAll(/[A-Za-z][A-Za-z0-9:_-]*/g)].map(item => item[0].toLowerCase()) : [];
}

/** Read-only local setup check: never lists, starts, or creates a Codespace. */
export async function runPreflight({ cwd, runProcessImpl = runProcess, detectContext = detectRepositoryContext, ghPath = process.env.GH_PATH || 'gh' } = {}) {
  const checks = [];
  const tryGh = async args => {
    try { return await runProcessImpl(ghPath, args, { timeoutMs: args[0] === '--version' ? 10_000 : 15_000 }); }
    catch { return { exitCode: 127, stdout: '', stderr: '' }; }
  };
  checks.push({
    name: 'Node.js',
    ok: Number(process.versions.node.split('.')[0]) >= 20,
    detail: Number(process.versions.node.split('.')[0]) >= 20 ? `Node ${process.versions.node} is supported.` : `Node ${process.versions.node} found; install Node.js 20 or later.`
  });

  const ghVersion = await tryGh(['--version']);
  const ghInstalled = ghVersion.exitCode === 0;
  checks.push({ name: 'GitHub CLI', ok: ghInstalled, detail: ghInstalled ? 'GitHub CLI is installed.' : 'GitHub CLI was not found or did not run; install gh and ensure it is on PATH.' });

  if (ghInstalled) {
    const auth = await tryGh(['auth', 'status', '--hostname', 'github.com']);
    const authenticated = auth.exitCode === 0;
    const scopes = scopesFromStatus(`${auth.stdout || ''}\n${auth.stderr || ''}`);
    const hasCodespaceScope = scopes.includes('codespace');
    checks.push({
      name: 'GitHub CLI authentication',
      ok: authenticated,
      detail: authenticated ? 'gh is authenticated to GitHub.com.' : 'Sign in with `gh auth login -h github.com -s codespace`.'
    });
    checks.push({
      name: 'Codespaces permission',
      ok: authenticated && hasCodespaceScope,
      detail: !authenticated ? 'Cannot check scope until gh is authenticated.' : hasCodespaceScope ? 'The active gh account reports the `codespace` scope.' : 'The active gh account lacks the `codespace` scope; run `gh auth refresh -h github.com -s codespace`.'
    });
  } else {
    checks.push({ name: 'GitHub CLI authentication', ok: false, detail: 'Install gh before signing in.' });
    checks.push({ name: 'Codespaces permission', ok: false, detail: 'Install and authenticate gh before checking Codespaces permission.' });
  }

  try {
    const context = await detectContext({ cwd });
    checks.push({ name: 'GitHub repository and branch', ok: true, detail: `Detected ${context.repository} on ${context.branch}.` });
  } catch (error) {
    checks.push({ name: 'GitHub repository and branch', ok: false, detail: error.message });
  }

  return {
    ready: checks.every(check => check.ok),
    checkedAt: new Date().toISOString(),
    codespaceProvisioningAttempted: false,
    checks
  };
}
