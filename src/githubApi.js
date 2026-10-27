const { runCommand, rateLimitMessage } = require('./utils');
const { findGhExecutable } = require('./sshManager');

const GITHUB_API_BASE = 'https://api.github.com';
const API_HEADERS = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Antigravity-Codespaces-Pro'
};

const FETCH_TIMEOUT_MS = 15000;
const RETRY_5XX_DELAY_MS = 5000;
const GITHUB_STATUS_URL = 'https://www.githubstatus.com/';

/** Error with a machine-readable kind ('timeout' | 'server' | 'network') for the UI. */
class GithubRequestError extends Error {
    constructor(kind, message, status) { super(message); this.name = 'GithubRequestError'; this.kind = kind; this.status = status; }
}

/**
 * fetch with a 15s timeout and one automatic retry (after 5s) on 5xx.
 * Throws GithubRequestError for timeouts, network failures and persistent 5xx.
 */
async function ghFetch(url, opts = {}, deps = {}) {
    const fetchImpl = deps.fetchImpl || fetch;
    const timeoutMs = deps.timeoutMs || FETCH_TIMEOUT_MS;
    const retryDelay = deps.retryDelayMs == null ? RETRY_5XX_DELAY_MS : deps.retryDelayMs;
    const once = async () => {
        // Own controller + ref'd timer (AbortSignal.timeout's timer is unref'd and can't be cleared).
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), timeoutMs);
        try {
            return await fetchImpl(url, { ...opts, signal: ctrl.signal });
        } catch (err) {
            if (ctrl.signal.aborted) throw new GithubRequestError('timeout', `GitHub isn't responding (${Math.round(timeoutMs / 1000)}s).`);
            if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
                throw new GithubRequestError('timeout', `GitHub isn't responding (${Math.round(timeoutMs / 1000)}s).`);
            }
            throw new GithubRequestError('network', "Couldn't reach GitHub. Check your internet connection.");
        } finally {
            clearTimeout(timer);
        }
    };
    let res = await once();
    if (res.status >= 500) {
        await new Promise(r => setTimeout(r, retryDelay));
        res = await once();
        if (res.status >= 500) throw new GithubRequestError('server', 'GitHub is having trouble right now.', res.status);
    }
    return res;
}

/**
 * Rate limit: 429, or 403 with x-ratelimit-remaining: 0 (same rule as usageService).
 * Returns a GithubRequestError(kind 'rateLimit') with resetAt from x-ratelimit-reset / retry-after, else null.
 */
function rateLimitError(res, nowMs = Date.now()) {
    if (!res) return null;
    const h = (k) => (res.headers && typeof res.headers.get === 'function' ? res.headers.get(k) : null);
    const limited = res.status === 429 || (res.status === 403 && String(h('x-ratelimit-remaining')) === '0');
    if (!limited) return null;
    let resetAt = null;
    const reset = h('x-ratelimit-reset'), ra = h('retry-after');
    if (reset && Number.isFinite(Number(reset))) resetAt = new Date(Number(reset) * 1000).toISOString();
    else if (ra && Number.isFinite(Number(ra))) resetAt = new Date(nowMs + Number(ra) * 1000).toISOString();
    const e = new GithubRequestError('rateLimit', rateLimitMessage(resetAt), res.status);
    e.resetAt = resetAt;
    return e;
}

class GithubApi {
    constructor(authManager, deps = {}) {
        this._authManager = authManager;
        this._fetchDeps = deps;
        this._runCommand = deps.runCommand || runCommand;
        // Cache entries are { data, at } so entries expire instead of going stale.
        this._csCache = new Map();
        this._metaCache = new Map();
        this._portsCache = new Map();
    }

    _fetch(url, opts) { return ghFetch(url, opts, this._fetchDeps); }

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

    _requireAccountToken(token, account) {
        if (token) return token;
        const active = this._authManager && this._authManager.getActiveAccount
            ? this._authManager.getActiveAccount()
            : null;
        const target = account || active || 'selected account';
        throw new Error(`No account-bound GitHub token is available for "${target}". Sign in to that account before using Codespaces.`);
    }

    /**
     * Follows REST pagination (per_page=100) up to maxPages pages.
     */
    async _fetchAllPages(baseUrl, token, maxPages = 5) {
        const out = [];
        for (let page = 1; page <= maxPages; page++) {
            const sep = baseUrl.includes('?') ? '&' : '?';
            const res = await this._fetch(`${baseUrl}${sep}per_page=100&page=${page}`, {
                headers: { ...API_HEADERS, 'Authorization': `Bearer ${token}` }
            });
            if (res.status === 401) throw new Error('GitHub authentication expired or token is invalid. Please sign in again.');
            { const rl = rateLimitError(res); if (rl) throw rl; }
            if (!res.ok) return { items: out, incomplete: true, status: res.status };
            const data = await res.json();
            const items = Array.isArray(data) ? data : (data.codespaces || []);
            out.push(...items);
            if (items.length < 100) break;
            if (page === maxPages) {
                return { items: out, incomplete: true, status: 200, limitReached: true };
            }
        }
        return { items: out, incomplete: false, status: 200 };
    }

    /**
     * Lists Codespaces for an account. Prefers direct REST API, falls back to CLI.
     */
    async listCodespaces(account) {
        let restErr = null;
        const cacheKey = this._csKey(account);
        const cached = this._getFresh(this._csCache, cacheKey, GithubApi.TTL_CS);
        if (cached !== undefined) {
            return cached;
        }

        const token = this._requireAccountToken(await this._authManager.getToken(account), account);

        // 1. Direct REST API (Zero CLI dependency!)
        if (token) {
            try {
                const { items, incomplete, status, limitReached } = await this._fetchAllPages(
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
                restErr = new Error(limitReached
                    ? 'GitHub REST API reached the 500-Codespace pagination limit; results may be incomplete.'
                    : status === 403
                        ? 'Access denied (HTTP 403). The account token may lack the "codespace" OAuth permission.'
                        : `GitHub REST API returned HTTP ${status}`);
            } catch (err) {
                // Auth/rate-limit errors must surface, not silently fall back.
                if (err && err.kind || /authentication expired|rate limit/i.test(err.message || '')) throw err;
                restErr = err;
                console.warn(`REST listCodespaces(${account}) failed, trying CLI fallback:`, err.message);
            }
        }

        // 2. CLI Fallback
        try {
            const ghExe = findGhExecutable();
            const envOpts = { env: { ...process.env, GH_TOKEN: token } };
            const raw = await this._runCommand(ghExe, [
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
        const raw = `${restErr && restErr.message ? restErr.message : ''} ${cliErr && cliErr.message ? cliErr.message : ''}`.trim();
        if (/needs the "codespace" scope|Must have admin rights|lack the "codespace"/i.test(raw)) {
            return new Error(`Account "${who}" is missing the "codespace" permission. Run "gh auth refresh -h github.com -s codespace" or click Sign In to authenticate.`);
        }
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
        const token = this._requireAccountToken(await this._authManager.getToken(account), account);
        if (token) {
            try {
                const res = await this._fetch(`${GITHUB_API_BASE}/user/codespaces/${encodeURIComponent(name)}/start`, {
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
                { const rl = rateLimitError(res); if (rl) throw rl; }
                if (res.status === 401) {
                    throw new Error('GitHub authentication expired or token is invalid. Please sign in again.');
                }
            } catch (err) {
                if (err && err.kind || /authentication expired/i.test(err.message || '')) throw err;
                console.warn('REST start failed, attempting CLI fallback:', err.message);
            }
        }

        // CLI Fallback: use gh api POST endpoint (gh codespace start is not a native CLI command)
        try {
            const ghExe = findGhExecutable();
            const envOpts = { env: { ...process.env, GH_TOKEN: token } };
            await this._runCommand(ghExe, ['api', '-X', 'POST', `/user/codespaces/${encodeURIComponent(name)}/start`], 120000, envOpts);
            this._invalidateCs(account);
            return true;
        } catch (cliErr) {
            // Secondary CLI Fallback: ping via SSH (connecting automatically boots a stopped container)
            try {
                const ghExe = findGhExecutable();
                const envOpts = { env: { ...process.env, GH_TOKEN: token } };
                await this._runCommand(ghExe, ['cs', 'ssh', '-c', name, '--', 'echo', 'started'], 45000, envOpts);
                this._invalidateCs(account);
                return true;
            } catch (e) { console.warn(`start ${name}: SSH wake fallback failed:`, e && e.message); }
            console.warn('CLI start fallback failed:', cliErr.message);
            throw cliErr;
        }
    }

    /**
     * Stops a running Codespace.
     */
    async stopCodespace(name, account) {
        const token = this._requireAccountToken(await this._authManager.getToken(account), account);
        if (token) {
            try {
                const res = await this._fetch(`${GITHUB_API_BASE}/user/codespaces/${encodeURIComponent(name)}/stop`, {
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
                { const rl = rateLimitError(res); if (rl) throw rl; }
                if (res.status === 401) {
                    throw new Error('GitHub authentication expired or token is invalid. Please sign in again.');
                }
            } catch (err) {
                if (err && err.kind || /authentication expired/i.test(err.message || '')) throw err;
            }
        }

        // CLI Fallback
        try {
            const ghExe = findGhExecutable();
            const envOpts = { env: { ...process.env, GH_TOKEN: token } };
            await this._runCommand(ghExe, ['codespace', 'stop', '-c', name], 30000, envOpts);
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
        const token = this._requireAccountToken(await this._authManager.getToken(account), account);
        if (token) {
            try {
                const res = await this._fetch(`${GITHUB_API_BASE}/user/codespaces/${encodeURIComponent(name)}`, {
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
                { const rl = rateLimitError(res); if (rl) throw rl; }
                if (res.status === 401) {
                    throw new Error('GitHub authentication expired or token is invalid. Please sign in again.');
                }
            } catch (err) {
                if (err && err.kind || /authentication expired/i.test(err.message || '')) throw err;
            }
        }

        // CLI Fallback
        try {
            const ghExe = findGhExecutable();
            const envOpts = { env: { ...process.env, GH_TOKEN: token } };
            await this._runCommand(ghExe, ['codespace', 'delete', '-c', name, '--force'], 30000, envOpts);
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
        const token = this._requireAccountToken(await this._authManager.getToken(account), account);
        const ghExe = findGhExecutable();
        const envOpts = { env: { ...process.env, GH_TOKEN: token } };
        const args = ['codespace', 'rebuild', '-c', name, ...(full ? ['--full'] : [])];
        try {
            await this._runCommand(ghExe, args, 180000, envOpts);
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
            const envOpts = { env: { ...process.env, GH_TOKEN: this._requireAccountToken(token, account) } };
            const ghExe = findGhExecutable();
            const raw = await this._runCommand(ghExe, ['codespace', 'ports', '-c', name, '--json', 'sourcePort,label,visibility,browseUrl'], 7000, envOpts);
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
        // Normalize recentFolders from gh CLI (array of folder paths)
        let recentFolders = null;
        if (Array.isArray(m.recentFolders)) {
            recentFolders = m.recentFolders.filter(f => typeof f === 'string' && f.startsWith('/'));
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
            account: account || '',
            recentFolders: recentFolders,
            devcontainerPath: m.devcontainerPath || m.devcontainer_path || null
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
                const res = await this._fetch(`${GITHUB_API_BASE}/user/codespaces/${encodeURIComponent(name)}`, {
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
            } catch (err) { console.warn(`fetchMeta(${name}) failed:`, err && err.message); }
        }

        try {
            const envOpts = { env: { ...process.env, GH_TOKEN: this._requireAccountToken(token, account) } };
            const ghExe = findGhExecutable();
            const raw = await this._runCommand(ghExe, [
                'codespace', 'view', '-c', name,
                '--json', 'displayName,name,repository,state,gitStatus,machineDisplayName,machineName,createdAt,lastUsedAt,idleTimeoutMinutes,retentionPeriodDays,location,recentFolders,devcontainerPath'
            ], 8000, envOpts);
            const m = this._normalizeMeta(JSON.parse(raw || '{}'), account);
            this._setFresh(this._metaCache, cacheKey, m);
            return m;
        } catch {
            return {};
        }
    }

    /**
     * Determines the best remote folder to open for a codespace.
     * Priority: recentFolders[0] > devcontainer workspaceFolder > template fallback.
     * @param {object} meta - Codespace metadata from fetchMeta
     * @param {string} repository - Repository name (owner/repo)
     * @param {string} codespaceName - Codespace name
     * @param {string} folderTemplate - Template string with ${repo} and ${name} placeholders
     * @returns {string} The folder path to open
     */
    static getBestFolder(meta, repository, codespaceName, folderTemplate = '/workspaces/${repo}') {
        // Priority 1: Most recent folder from recentFolders
        if (meta && Array.isArray(meta.recentFolders) && meta.recentFolders.length > 0) {
            const recent = meta.recentFolders[0];
            if (typeof recent === 'string' && recent.startsWith('/')) {
                return recent;
            }
        }
        
        // Priority 2: Derive from devcontainerPath (usually .devcontainer/devcontainer.json)
        // The workspaceFolder is typically /workspaces/<repo> by convention
        if (meta && meta.devcontainerPath) {
            const repoShort = (repository || codespaceName || '').split('/').pop() || 'workspace';
            return `/workspaces/${repoShort.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        }
        
        // Priority 3: Fall back to template
        const repoShort = (repository || codespaceName || '').split('/').pop() || 'workspace';
        return folderTemplate
            .replace(/\${repo}/g, repoShort.replace(/[^a-zA-Z0-9_-]/g, '-'))
            .replace(/\${name}/g, (codespaceName || '').replace(/[^a-zA-Z0-9_-]/g, '-'));
    }

    /**
     * Fetches repositories for creating a new Codespace (paginated, up to 500).
     */
    async fetchUserRepos(account) {
        const token = await this._authManager.getToken(account);
        if (token) {
            let pages = null;
            try {
                pages = await this._fetchAllPages(
                    `${GITHUB_API_BASE}/user/repos?sort=updated`, token, 5);
            } catch (err) {
                if (err && err.kind || /authentication expired|rate limit/i.test(err.message || '')) throw err;
            }
            if (pages) {
                const { items, incomplete, status, limitReached } = pages;
                if (incomplete) {
                    const reason = limitReached
                        ? 'the 500-repository pagination limit was reached, so additional results may be missing'
                        : `GitHub stopped pagination with HTTP ${status}`;
                    throw new Error(`Repository list is incomplete: ${reason}. Please retry or enter the repository manually.`);
                }
                return items.map(r => ({
                    name: r.name,
                    nameWithOwner: r.full_name,
                    isPrivate: r.private,
                    description: r.description || ''
                }));
            }
        }

        try {
            const envOpts = { env: { ...process.env, GH_TOKEN: this._requireAccountToken(token, account) } };
            const ghExe = findGhExecutable();
            const raw = await this._runCommand(ghExe, [
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
    async createCodespace(repo, branch, account, machine = '') {
        const token = await this._authManager.getToken(account);
        const { owner, repoName, cleanRepo } = GithubApi.normalizeRepoInput(repo);
        if (!owner || !repoName) {
            throw new Error('Enter a repository in owner/repo format.');
        }
        const cleanBranch = (branch || '').trim();
        const chosenMachine = (machine || '').trim();
        this._requireAccountToken(token, account);

        // Direct REST API
        if (token) {
            try {
                const body = {};
                if (cleanBranch) body.ref = cleanBranch;
                if (chosenMachine) body.machine = chosenMachine;
                const res = await this._fetch(`${GITHUB_API_BASE}/repos/${owner}/${repoName}/codespaces`, {
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
                const errJson = await res.json().catch(() => ({}));
                const apiMsg = errJson.message || `HTTP ${res.status}`;
                { const rl = rateLimitError(res); if (rl) throw rl; }
                if (res.status === 401) {
                    throw new Error('GitHub authentication expired or token is invalid. Please sign in again.');
                }
                if (res.status === 403) {
                    throw new Error(`Codespace creation denied (403): ${apiMsg}. Verify that Codespaces permissions and billing are enabled.`);
                }
                if (res.status === 404) {
                    throw new Error(`Repository "${cleanRepo}" not found or not accessible.`);
                }
                if (res.status === 422) {
                    throw new Error(`Invalid parameters for "${cleanRepo}": ${apiMsg}`);
                }
            } catch (err) {
                if (err && err.kind || /authentication expired|owner\/repo format|creation denied|not found|Invalid parameters/i.test(err.message || '')) throw err;
                console.warn('REST createCodespace failed, attempting CLI fallback:', err.message);
            }
        }

        const ghExe = findGhExecutable();
        const envOpts = { env: { ...process.env, GH_TOKEN: token } };
        const args = ['codespace', 'create', '-R', cleanRepo, '--default-permissions'];
        if (cleanBranch) args.push('-b', cleanBranch);
        args.push('-m', chosenMachine || 'basicLinux32gb');

        try {
            const result = await this._runCommand(ghExe, args, 120000, envOpts);
            this._invalidateCs(account);
            return result;
        } catch (cliErr) {
            // If repository does not offer basicLinux32gb tier, retry once without -m constraint
            if (cliErr.message && cliErr.message.includes('basicLinux32gb')) {
                const retryArgs = ['codespace', 'create', '-R', cleanRepo, '--default-permissions'];
                if (cleanBranch) retryArgs.push('-b', cleanBranch);
                const retryResult = await this._runCommand(ghExe, retryArgs, 120000, envOpts);
                this._invalidateCs(account);
                return retryResult;
            }
            throw cliErr;
        }
    }
}

module.exports = {
    rateLimitError, ghFetch, GithubRequestError, FETCH_TIMEOUT_MS, GITHUB_STATUS_URL, GithubApi };
