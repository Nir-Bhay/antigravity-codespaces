const { runCommand } = require('./utils');
const { findGhExecutable } = require('./sshManager');

const GITHUB_API_BASE = 'https://api.github.com';
const API_HEADERS = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Antigravity-Codespaces-Pro'
};

class GithubApi {
    constructor(authManager) {
        this._authManager = authManager;
        this._csCache = new Map();
        this._metaCache = new Map();
        this._portsCache = new Map();
    }

    clearCache() {
        this._csCache.clear();
        this._metaCache.clear();
        this._portsCache.clear();
    }

    /**
     * Lists Codespaces for an account. Prefers direct REST API, falls back to CLI.
     */
    async listCodespaces(account) {
        const cacheKey = account || 'default';
        if (this._csCache.has(cacheKey)) {
            return this._csCache.get(cacheKey);
        }

        const token = await this._authManager.getToken(account);

        // 1. Direct REST API (Zero CLI dependency!)
        if (token) {
            try {
                const res = await fetch(`${GITHUB_API_BASE}/user/codespaces?per_page=100`, {
                    headers: {
                        ...API_HEADERS,
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (res.ok) {
                    const data = await res.json();
                    const list = (data.codespaces || []).map(cs => ({
                        name: cs.name,
                        displayName: cs.display_name || cs.name,
                        repository: cs.repository ? cs.repository.full_name : '',
                        gitStatus: {
                            ref: cs.git_status?.ref || '',
                            ahead: cs.git_status?.ahead || 0,
                            behind: cs.git_status?.behind || 0,
                            hasUncommittedChanges: cs.git_status?.has_uncommitted_changes || false,
                            hasUnpushedChanges: cs.git_status?.has_unpushed_changes || false
                        },
                        state: cs.state, // 'Available', 'Shutdown', etc.
                        lastUsedAt: cs.last_used_at,
                        machineName: cs.machine?.name || '',
                        machineDisplayName: cs.machine?.display_name || '',
                        location: cs.location || '',
                        idleTimeoutMinutes: cs.idle_timeout_minutes || 30,
                        account: account
                    }));

                    this.sortCodespaces(list);
                    this._csCache.set(cacheKey, list);
                    return list;
                }
            } catch (err) {
                console.warn(`REST listCodespaces(${account}) failed, trying CLI fallback:`, err.message);
            }
        }

        // 2. CLI Fallback
        try {
            const ghExe = findGhExecutable();
            const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
            const raw = await runCommand(ghExe, [
                'codespace', 'list',
                '--json', 'name,displayName,repository,gitStatus,state,lastUsedAt,machineName'
            ], 12000, envOpts);

            const list = JSON.parse(raw || '[]').map(c => ({ ...c, account }));
            this.sortCodespaces(list);
            this._csCache.set(cacheKey, list);
            return list;
        } catch (cliErr) {
            console.warn(`CLI listCodespaces(${account}) failed:`, cliErr.message);
            return [];
        }
    }

    sortCodespaces(list) {
        list.sort((a, b) => {
            if (a.state === 'Available' && b.state !== 'Available') return -1;
            if (b.state === 'Available' && a.state !== 'Available') return 1;
            return new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0);
        });
    }

    /**
     * Starts a stopped Codespace via direct REST call (sub-second response).
     */
    async startCodespace(name, account) {
        const token = await this._authManager.getToken(account);
        if (token) {
            try {
                const res = await fetch(`${GITHUB_API_BASE}/user/codespaces/${encodeURIComponent(name)}/start`, {
                    method: 'POST',
                    headers: {
                        ...API_HEADERS,
                        'Authorization': `Bearer ${token}`
                    }
                });
                if (res.ok || res.status === 409) {
                    this._csCache.delete(account || 'default');
                    return true;
                }
            } catch (err) {
                console.warn('REST start failed, attempting CLI fallback:', err.message);
            }
        }

        const ghExe = findGhExecutable();
        const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
        await runCommand(ghExe, ['codespace', 'stop', '-c', name], 5000, envOpts).catch(() => {});
        await runCommand(ghExe, ['cs', 'ssh', '-c', name, '--', 'echo', 'up'], 30000, envOpts);
        this._csCache.delete(account || 'default');
        return true;
    }

    /**
     * Stops a running Codespace.
     */
    async stopCodespace(name, account) {
        const token = await this._authManager.getToken(account);
        if (token) {
            try {
                const res = await fetch(`${GITHUB_API_BASE}/user/codespaces/${encodeURIComponent(name)}/stop`, {
                    method: 'POST',
                    headers: {
                        ...API_HEADERS,
                        'Authorization': `Bearer ${token}`
                    }
                });
                if (res.ok || res.status === 409) {
                    this._csCache.delete(account || 'default');
                    return true;
                }
            } catch {}
        }

        const ghExe = findGhExecutable();
        const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
        await runCommand(ghExe, ['codespace', 'stop', '-c', name], 15000, envOpts);
        this._csCache.delete(account || 'default');
        return true;
    }

    /**
     * Permanently deletes a Codespace.
     */
    async deleteCodespace(name, account) {
        const token = await this._authManager.getToken(account);
        if (token) {
            try {
                const res = await fetch(`${GITHUB_API_BASE}/user/codespaces/${encodeURIComponent(name)}`, {
                    method: 'DELETE',
                    headers: {
                        ...API_HEADERS,
                        'Authorization': `Bearer ${token}`
                    }
                });
                if (res.ok || res.status === 204) {
                    this._csCache.delete(account || 'default');
                    return true;
                }
            } catch {}
        }

        const ghExe = findGhExecutable();
        const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
        await runCommand(ghExe, ['codespace', 'delete', '-c', name, '--force'], 15000, envOpts);
        this._csCache.delete(account || 'default');
        return true;
    }

    /**
     * Rebuilds devcontainer (cached vs clean full rebuild).
     */
    async rebuildCodespace(name, account, full = false) {
        const token = await this._authManager.getToken(account);
        const ghExe = findGhExecutable();
        const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
        const args = ['codespace', 'rebuild', '-c', name, ...(full ? ['--full'] : [])];
        await runCommand(ghExe, args, 60000, envOpts);
        this._csCache.delete(account || 'default');
        return true;
    }

    /**
     * Fetches forwarded ports for a container.
     */
    async fetchPorts(name, account) {
        const cacheKey = `${account || ''}:${name}`;
        if (this._portsCache.has(cacheKey)) return this._portsCache.get(cacheKey);

        const token = await this._authManager.getToken(account);
        try {
            const ghExe = findGhExecutable();
            const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
            const raw = await runCommand(ghExe, ['codespace', 'ports', '-c', name, '--json', 'sourcePort,label,visibility,browseUrl'], 7000, envOpts);
            const p = JSON.parse(raw || '[]');
            this._portsCache.set(cacheKey, p);
            return p;
        } catch {
            return [];
        }
    }

    /**
     * Fetches detailed machine and lifecycle metadata.
     */
    async fetchMeta(name, account) {
        const cacheKey = `${account || ''}:${name}`;
        if (this._metaCache.has(cacheKey)) return this._metaCache.get(cacheKey);

        const token = await this._authManager.getToken(account);
        if (token) {
            try {
                const res = await fetch(`${GITHUB_API_BASE}/user/codespaces/${encodeURIComponent(name)}`, {
                    headers: { ...API_HEADERS, 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const cs = await res.json();
                    const m = {
                        displayName: cs.display_name || cs.name,
                        name: cs.name,
                        repository: cs.repository?.full_name || '',
                        state: cs.state,
                        machineDisplayName: cs.machine?.display_name || cs.machine?.name || '2 vCPU, 8 GB RAM',
                        machineName: cs.machine?.name || '',
                        createdAt: cs.created_at,
                        lastUsedAt: cs.last_used_at,
                        idleTimeoutMinutes: cs.idle_timeout_minutes || 30,
                        location: cs.location || '',
                        account: account
                    };
                    this._metaCache.set(cacheKey, m);
                    return m;
                }
            } catch {}
        }

        try {
            const ghExe = findGhExecutable();
            const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
            const raw = await runCommand(ghExe, [
                'codespace', 'view', '-c', name,
                '--json', 'displayName,name,repository,state,gitStatus,machineDisplayName,machineName,createdAt,lastUsedAt,idleTimeoutMinutes,retentionPeriodDays,location'
            ], 8000, envOpts);
            const m = JSON.parse(raw || '{}');
            this._metaCache.set(cacheKey, m);
            return m;
        } catch {
            return {};
        }
    }

    /**
     * Fetches repositories for creating a new Codespace.
     */
    async fetchUserRepos(account) {
        const token = await this._authManager.getToken(account);
        if (token) {
            try {
                const res = await fetch(`${GITHUB_API_BASE}/user/repos?per_page=100&sort=updated`, {
                    headers: { ...API_HEADERS, 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const repos = await res.json();
                    return repos.map(r => ({
                        name: r.name,
                        nameWithOwner: r.full_name,
                        isPrivate: r.private,
                        description: r.description || ''
                    }));
                }
            } catch {}
        }

        try {
            const ghExe = findGhExecutable();
            const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
            const raw = await runCommand(ghExe, [
                'repo', 'list', '--limit', '100',
                '--json', 'name,nameWithOwner,isPrivate,description'
            ], 12000, envOpts);
            return JSON.parse(raw || '[]');
        } catch {
            return [];
        }
    }

    /**
     * Provisions a new Codespace on a repository and branch.
     */
    async createCodespace(repo, branch, account) {
        const token = await this._authManager.getToken(account);
        // Direct REST API
        if (token) {
            try {
                const [owner, repoName] = repo.split('/');
                if (owner && repoName) {
                    const body = {};
                    if (branch) body.ref = branch;
                    const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repoName}/codespaces`, {
                        method: 'POST',
                        headers: {
                            ...API_HEADERS,
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(body)
                    });
                    if (res.ok) {
                        const newCs = await res.json();
                        this._csCache.delete(account || 'default');
                        return newCs.name;
                    }
                }
            } catch (err) {
                console.warn('REST createCodespace failed, attempting CLI fallback:', err.message);
            }
        }

        const ghExe = findGhExecutable();
        const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
        const args = ['codespace', 'create', '-r', repo];
        if (branch) args.push('-b', branch);
        const result = await runCommand(ghExe, args, 120000, envOpts);
        this._csCache.delete(account || 'default');
        return result;
    }
}

module.exports = { GithubApi };
