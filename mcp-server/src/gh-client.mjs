import { runProcess } from './process-runner.mjs';

const DEFAULT_GH_PATH = process.env.GH_PATH || 'gh';
const MAX_ERROR_CHARS = 1_000;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function cliError(args, result) {
  const detail = (result.stderr || result.stdout || '').trim().slice(0, MAX_ERROR_CHARS);
  const verb = args.slice(0, 2).join(' ');
  const lowerDetail = detail.toLowerCase();
  if (/api rate limit exceeded|secondary rate limit|rate limit exceeded/.test(lowerDetail)) {
    return new Error(`GitHub API rate limit reached while running gh ${verb}; retry after the limit resets.${detail ? ` ${detail}` : ''}`);
  }
  if (/quota|billing|spending limit/.test(lowerDetail) && /codespace/i.test(args.join(' '))) {
    return new Error(`Codespaces quota or billing limit blocked the request. Check GitHub Codespaces usage and billing.${detail ? ` ${detail}` : ''}`);
  }

  const startPath = args.find(argument => /^\/user\/codespaces\/[^/]+\/start$/.test(argument));
  const cliNameIndex = args[0] === 'codespace' && args[1] === 'start' ? args.indexOf('--codespace') : -1;
  const encodedName = startPath?.split('/').at(-2) || (cliNameIndex >= 0 ? args[cliNameIndex + 1] : null);
  if (encodedName) {
    let name = encodedName;
    try { name = decodeURIComponent(encodedName); } catch {}
    return new Error(`Could not start Codespace ${name}${detail ? `: ${detail}` : '.'}`);
  }

  return new Error(`gh ${verb} failed with exit code ${result.exitCode}${detail ? `: ${detail}` : '.'}`);
}

function parseJson(text, description) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GitHub CLI returned invalid JSON for ${description}.`);
  }
}

export function createGhClient({ ghPath = DEFAULT_GH_PATH, env = process.env, runProcessImpl = runProcess } = {}) {
  async function execute(args, { timeoutMs = 30_000 } = {}) {
    const result = await runProcessImpl(ghPath, args, { env, timeoutMs });
    if (result.exitCode !== 0) throw cliError(args, result);
    return result.stdout.trim();
  }

  return {
    async listCodespaces() {
      const output = await execute([
        'codespace', 'list', '--limit', '1000', '--json',
        'name,displayName,repository,gitStatus,state,lastUsedAt,machineName'
      ], { timeoutMs: 30_000 });
      const result = parseJson(output || '[]', 'Codespaces list');
      if (!Array.isArray(result)) throw new Error('GitHub CLI returned a non-list Codespaces response.');
      return result;
    },

    async getCodespace(name) {
      const output = await execute(['api', `/user/codespaces/${encodeURIComponent(name)}`], { timeoutMs: 30_000 });
      return parseJson(output, 'Codespace status');
    },

    async createCodespace(repository, branch) {
      if (!REPOSITORY_RE.test(repository)) throw new TypeError('repository must use owner/repository format.');
      const id = await execute(['api', `repos/${repository}`, '--jq', '.id'], { timeoutMs: 30_000 });
      if (!/^\d+$/.test(id)) throw new Error('GitHub CLI returned an invalid repository id.');
      const output = await execute([
        'api', '-X', 'POST', '/user/codespaces',
        '-F', `repository_id=${id}`,
        '-F', `ref=${branch}`
      ], { timeoutMs: 60_000 });
      const created = parseJson(output, 'Codespace creation');
      if (typeof created.name !== 'string' || !created.name) throw new Error('GitHub did not return a Codespace name after creation.');
      return created;
    },

    async startCodespace(name) {
      await execute(['api', '-X', 'POST', `/user/codespaces/${encodeURIComponent(name)}/start`], { timeoutMs: 120_000 });
    },

    async stopCodespace(name) {
      await execute(['codespace', 'stop', '--codespace', name], { timeoutMs: 60_000 });
    },

    async getCodespaceLogs(name) {
      return execute(['codespace', 'logs', '--codespace', name], { timeoutMs: 30_000 });
    },

    async getCodespacePorts(name) {
      const output = await execute([
        'codespace', 'ports', '--codespace', name,
        '--json', 'portNumber,protocol,visibility,forwardedUrl'
      ], { timeoutMs: 30_000 });
      const result = parseJson(output || '[]', 'Codespace ports');
      if (!Array.isArray(result)) throw new Error('GitHub CLI returned a non-list ports response.');
      return result;
    }
  };
}
