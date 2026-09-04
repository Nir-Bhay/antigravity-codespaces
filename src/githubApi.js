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
        // Cache entries are { data, at } so entries expire instead of going stale.
        this._csCache = new Map();
        this._metaCache = new Map();
        this._portsCache = new Map();
    }

    clearCache() {
        this._csCache.clear();
        this._metaCache.clear();
        this._portsCache.clear();
    }

    // Cache lifetimes: lists 30s, machine metadata 60s, forwarded ports 15s.
    static get TTL_CS() { return 30 * 1000; }
    static get TTL_META() { return 60 * 1000; }
    static get TTL_PORTS() { return 15 * 1000; }

    /**
     * Resolves the cache key with the active account so two accounts never share
     * the 'default' bucket when callers omit the account.
     */
    _csKey(account) {
        const resolved = account || (this._authManager && this._authManager.getActiveAccount()) || 'default';
        return `cs:${resolved}`;
    }

    _scopedKey(account, name) {
        const resolved = account || (this._authManager && this._authManager.getActiveAccount()) || '';
        return `${resolved}:${name}`;
    }

    _getFresh(map, key, ttl) {
        const entry = map.get(key);
        if (!entry) return undefined;
        if (Date.now() - entry.at > ttl) {
            map.delete(key);
            return undefined;
        }
        return entry.data;
    }

    _setFresh(map, key, data) {
        map.set(key, { data, at: Date.now() });
    }

    _invalidateCs(account) {
        this._csCache.delete(this._csKey(account));
    }

    /**
     * Follows REST pagination (per_page=100) up to maxPages pages.
     */
    async _fetchAllPages(baseUrl, token, maxPages = 5) {
        const out = [];
        for (let page = 1; page <= maxPages; page++) {
            const sep = baseUrl.includes('?') ? '&' : '?';
            const res = await fetch(`${baseUrl}${sep}per_page=100&page=${page}`, {
                headers: { ...API_HEADERS, 'Authorization': `Bearer ${token}` }
            });
            if (res.status === 401) throw new Error('GitHub authentication expired or token is invalid. Please sign in again.');
            if (res.status === 429) throw new Error('GitHub API rate limit reached. Wait a few minutes, then refresh.');
            if (!res.ok) return { items: out, incomplete: true, status: res.status };
            const data = await res.json();
            const items = Array.isArray(data) ? data : (data.codespaces || []);
            out.push(...items);
            if (items.length < 100) break;
        }
        return { items: out, incomplete: false, status: 200 };
    }

    /**
     * Lists Codespaces for an account. Prefers direct REST API, falls back to CLI.
     */
    async listCodespaces(account) {
        const cacheKey = this._csKey(account);
        const cached = this._getFresh(this._csCache, cacheKey, GithubApi.TTL_CS);
        if (cached !== undefined) {
            return cached;
        }

        const token = await this._authManager.getToken(account);

        // 1. Direct REST API (Zero CLI dependency!)
        if (token) {
            try {
                const { items, incomplete } = await this._fetchAllPages(
                    `${GITHUB_API_BASE}/user/codespaces`, token, 5);
                if (!incomplete) {
                    const list = items.map(cs => ({
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
                    this._setFresh(this._csCache, cacheKey, list);
                    return list;
                }
            } catch (err) {
                // Auth/rate-limit errors must surface, not silently fall back.
                if (/authentication expired|rate limit/i.test(err.message || '')) throw err;
                restErr = err;
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
            this._setFresh(this._csCache, cacheKey, list);
            return list;
        } catch (cliErr) {
            // Total failure must SURFACE (dashboard banners, sidebar error state,
            // status-bar tooltip all handle it) — never masquerade as "no machines".
            throw GithubApi.buildListError(account, restErr, cliErr);
        }
    }

    /**
     * Builds the guided aggregate error when both REST and CLI list paths fail.
     * Pure — fully unit-testable.
     */
    static buildListError(account, restErr, cliErr) {
        const who = account || 'active account';
        const cause = ((restErr && restErr.message) || (cliErr && cliErr.message) || 'unknown error');
        return new Error(`Couldn't load Codespaces for "${who}": ${cause}. Check your connection and sign-in, then press Refresh (details in Antigravity Codespaces logs).`);
    }

    sortCodespaces(list) {
        list.sort((a, b) => {
            if (a.state === 'Available' && b.state !== 'Available') return -1;
            if (b.state === 'Available' && a.state !== 'Available') return 1;
            const ta = new Date(b.lastUsedAt || 0).getTime();
            const tb = new Date(a.lastUsedAt || 0).getTime();
            if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
            if (Number.isFinite(ta)) return -1;
            if (Number.isFinite(tb)) return 1;
            return 0;
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
                    this._invalidateCs(account);
                    return true;
                }
                if (res.status === 401) {
                    throw new Error('GitHub authentication expired or token is invalid. Please sign in again.');
                }
            } catch (err) {
                if (/authentication expired/i.test(err.message || '')) throw err;
                console.warn('REST start failed, attempting CLI fallback:', err.message);
            }
        }

        // CLI Fallback: use `gh codespace start` directly (not SSH ping)
        try {
            const ghExe = findGhExecutable();
            const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
            await runCommand(ghExe, ['codespace', 'start', '-c', name], 120000, envOpts);
            this._invalidateCs(account);
            return true;
        } catch (cliErr) {
            console.warn('CLI start fallback failed:', cliErr.message);
            throw cliErr;
        }
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
                    this._invalidateCs(account);
                    return true;
                }
                if (res.status === 401) {
                    throw new Error('GitHub authentication expired or token is invalid. Please sign in again.');
                }
            } catch (err) {
                if (/authentication expired/i.test(err.message || '')) throw err;
            }
        }

        // CLI Fallback
        try {
            const ghExe = findGhExecutable();
            const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
            await runCommand(ghExe, ['codespace', 'stop', '-c', name], 30000, envOpts);
            this._invalidateCs(account);
            return true;
        } catch (cliErr) {
            console.warn('CLI stop fallback failed:', cliErr.message);
            throw cliErr;
        }
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
                    this._invalidateCs(account);
                    return true;
                }
                if (res.status === 401) {
                    throw new Error('GitHub authentication expired or token is invalid. Please sign in again.');
                }
            } catch (err) {
                if (/authentication expired/i.test(err.message || '')) throw err;
            }
        }

        // CLI Fallback
        try {
            const ghExe = findGhExecutable();
            const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
            await runCommand(ghExe, ['codespace', 'delete', '-c', name, '--force'], 30000, envOpts);
            this._invalidateCs(account);
            return true;
        } catch (cliErr) {
            console.warn('CLI delete fallback failed:', cliErr.message);
            throw cliErr;
        }
    }

    /**
     * Rebuilds devcontainer (cached vs clean full rebuild).
     * Note: server-side rebuilds take minutes; the CLI timeout only bounds how
     * long we wait for acknowledgement, and callers report "rebuild started".
     */
    async rebuildCodespace(name, account, full = false) {
        const token = await this._authManager.getToken(account);
        const ghExe = findGhExecutable();
        const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
        const args = ['codespace', 'rebuild', '-c', name, ...(full ? ['--full'] : [])];
        try {
            await runCommand(ghExe, args, 180000, envOpts);
        } catch (err) {
            console.warn('rebuildCodespace CLI failed:', err.message);
            throw err;
        }
        this._invalidateCs(account);
        return true;
    }

    /**
     * Fetches forwarded ports for a container (short-lived cache: ports change often).
     */
    async fetchPorts(name, account) {
        const cacheKey = this._scopedKey(account, name);
        const cached = this._getFresh(this._portsCache, cacheKey, GithubApi.TTL_PORTS);
        if (cached !== undefined) return cached;

        const token = await this._authManager.getToken(account);
        try {
            const ghExe = findGhExecutable();
            const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
            const raw = await runCommand(ghExe, ['codespace', 'ports', '-c', name, '--json', 'sourcePort,label,visibility,browseUrl'], 7000, envOpts);
            const parsed = JSON.parse(raw || '[]');
            const p = Array.isArray(parsed) ? parsed : [];
            this._setFresh(this._portsCache, cacheKey, p);
            return p;
        } catch {
            return [];
        }
    }

    /**
     * Normalizes CLI `codespace view --json` output to the REST shape so all
     * consumers see identical fields (including `account`).
     */
    _normalizeMeta(raw, account) {
        const m = (raw && typeof raw === 'object') ? raw : {};
        let repository = '';
        if (typeof m.repository === 'string') repository = m.repository;
        else if (m.repository && typeof m.repository === 'object') {
            repository = m.repository.full_name || m.repository.fullName || m.repository.nameWithOwner || '';
        }
        return {
            displayName: m.displayName || m.display_name || m.name || '',
            name: m.name || '',
            repository,
            state: m.state || '',
            machineDisplayName: m.machineDisplayName || m.machine_display_name || m.machineName || m.machine_name || '2 vCPU, 8 GB RAM',
            machineName: m.machineName || m.machine_name || '',
            createdAt: m.createdAt || m.created_at || '',
            lastUsedAt: m.lastUsedAt || m.last_used_at || '',
            idleTimeoutMinutes: m.idleTimeoutMinutes || m.idle_timeout_minutes || 30,
            location: m.location || '',
            account: account || ''
        };
    }

    /**
     * Fetches detailed machine and lifecycle metadata.
     */
    async fetchMeta(name, account) {
        const cacheKey = this._scopedKey(account, name);
        const cached = this._getFresh(this._metaCache, cacheKey, GithubApi.TTL_META);
        if (cached !== undefined) return cached;

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
                    this._setFresh(this._metaCache, cacheKey, m);
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
            const m = this._normalizeMeta(JSON.parse(raw || '{}'), account);
            this._setFresh(this._metaCache, cacheKey, m);
            return m;
        } catch {
            return {};
        }
    }

    /**
     * Fetches repositories for creating a new Codespace (paginated, up to 500).
     */
    async fetchUserRepos(account) {
        const token = await this._authManager.getToken(account);
        if (token) {
            try {
                const { items, incomplete } = await this._fetchAllPages(
                    `${GITHUB_API_BASE}/user/repos?sort=updated`, token, 5);
                if (!incomplete || items.length > 0) {
                    return items.map(r => ({
                        name: r.name,
                        nameWithOwner: r.full_name,
                        isPrivate: r.private,
                        description: r.description || ''
                    }));
                }
            } catch (err) {
                if (/authentication expired|rate limit/i.test(err.message || '')) throw err;
            }
        }

        try {
            const ghExe = findGhExecutable();
            const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
            const raw = await runCommand(ghExe, [
                'repo', 'list', '--limit', '500',
                '--json', 'name,nameWithOwner,isPrivate,description'
            ], 12000, envOpts);
            const parsed = JSON.parse(raw || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /**
     * Validates and normalizes repository input to "owner/repo".
     * Accepts "owner/repo", URLs, and git@ forms; ignores trailing path segments
     * (e.g. "/tree/main" from a pasted browser URL) using the first two segments.
     */
    static normalizeRepoInput(repo) {
        const cleanRepo = (repo || '').trim()
            .replace(/^https?:\/\/github\.com\//i, '')
            .replace(/^git@github\.com:/i, '')
            .replace(/\.git$/i, '')
            .replace(/^\/+|\/+$/g, '');
        const parts = cleanRepo.split('/').filter(Boolean);
        if (parts.length < 2) return { owner: '', repoName: '', cleanRepo };
        const [owner, repoName] = parts;
        if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repoName)) {
            return { owner: '', repoName: '', cleanRepo };
        }
        return { owner, repoName, cleanRepo: `${owner}/${repoName}` };
    }

    /**
     * Provisions a new Codespace on a repository and branch.
     */
    async createCodespace(repo, branch, account) {
        const token = await this._authManager.getToken(account);
        const { owner, repoName, cleanRepo } = GithubApi.normalizeRepoInput(repo);
        if (!owner || !repoName) {
            throw new Error('Enter a repository in owner/repo format.');
        }
        const cleanBranch = (branch || '').trim();

        // Direct REST API
        if (token) {
            try {
                const body = {};
                if (cleanBranch) body.ref = cleanBranch;
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
                    this._invalidateCs(account);
                    return newCs.name;
                }
                if (res.status === 401) {
                    throw new Error('GitHub authentication expired or token is invalid. Please sign in again.');
                }
            } catch (err) {
                if (/authentication expired|owner\/repo format/i.test(err.message || '')) throw err;
                console.warn('REST createCodespace failed, attempting CLI fallback:', err.message);
            }
        }

        const ghExe = findGhExecutable();
        const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
        const args = ['codespace', 'create', '-r', cleanRepo];
        if (cleanBranch) args.push('-b', cleanBranch);
        const result = await runCommand(ghExe, args, 120000, envOpts);
        this._invalidateCs(account);
        return result;
    }
}

module.exports = { GithubApi };
