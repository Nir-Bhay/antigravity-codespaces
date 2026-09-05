let vscode;
try { vscode = require('vscode'); } catch {}
const { runCommand } = require('./utils');
const { findGhExecutable } = require('./sshManager');

const PAT_SECRET_KEY_PREFIX = 'antigravity_github_pat_';  // per-account PAT key (fixes: single-key stomping)
const PAT_SECRET_ACCOUNTS_KEY = 'antigravity_pat_accounts'; // index of accounts that have stored PATs

class AuthManager {
    constructor(context = {}) {
        this._context = context;
        this._tokenCache = new Map();
        // PAT validity stamps: { validAt } — avoids re-verifying stored PATs on
        // every discovery (slow startup, rate-limit burn, offline disappearance).
        this._patValidity = new Map();
        this._activeAccount = (this._context && this._context.globalState?.get('activeAccount')) || '';
        this._accounts = [];
        this._onAuthChangedEmitter = vscode?.EventEmitter ? new vscode.EventEmitter() : { event: () => {}, fire: () => {} };
        this.onAuthChanged = this._onAuthChangedEmitter.event;

        // Listen to native VS Code authentication session changes
        if (vscode?.authentication?.onDidChangeSessions && context?.subscriptions) {
            context.subscriptions.push(
                vscode.authentication.onDidChangeSessions(e => {
                    if (e.provider.id === 'github') {
                        this.clearCache();
                        this._onAuthChangedEmitter.fire();
                    }
                })
            );
        }
    }

    clearCache() {
        this._tokenCache.clear();
        this._patValidity.clear();
        this._accounts = [];
    }

    /**
     * Parses the PAT accounts index without ever throwing: a corrupt index is
     * repaired to [] instead of orphaning stored secrets or crashing logout.
     */
    async _readPatIndex() {
        try {
            const raw = await this._context.secrets.get(PAT_SECRET_ACCOUNTS_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) throw new Error('PAT index is not an array');
            return parsed.filter(a => typeof a === 'string');
        } catch (err) {
            console.warn('PAT accounts index unreadable, repairing:', err.message);
            try { await this._context.secrets.store(PAT_SECRET_ACCOUNTS_KEY, '[]'); } catch {}
            return [];
        }
    }

    async _writePatIndex(accounts) {
        await this._context.secrets.store(PAT_SECRET_ACCOUNTS_KEY, JSON.stringify(accounts));
    }

    getActiveAccount() {
        return this._activeAccount;
    }

    setActiveAccount(account) {
        this._activeAccount = account;
        this._context.globalState?.update('activeAccount', account);
        this._onAuthChangedEmitter.fire();
    }

    /**
     * Retrieves all authenticated accounts across Native OAuth, Secure PAT, and GitHub CLI.
     */
    async getAccounts() {
        const discovered = [];
        const seenNames = new Set();

        // 1. Check Native VS Code OAuth Session (NOT cached — VS Code handles its own refresh)
        try {
            const nativeSession = await vscode.authentication.getSession(
                'github',
                ['repo', 'codespace', 'user'],
                { createIfNone: false }
            );
            if (nativeSession && nativeSession.account) {
                const name = nativeSession.account.label;
                discovered.push({
                    account: name,
                    type: 'native',
                    active: false
                });
                seenNames.add(name);
                // Don't cache OAuth token — VS Code manages refresh; we fetch fresh on each getToken()
            }
        } catch {}

        // 2. Check Secure Stored PATs (per-account keys).
        // Stored PATs are trusted: re-verified at most every 10 minutes, and a
        // network failure keeps the account visible (offline tolerance) instead
        // of making it vanish and flapping the active account.
        try {
            const patAccounts = await this._readPatIndex();
            for (const storedLogin of patAccounts) {
                try {
                    const storedPat = await this._context.secrets.get(PAT_SECRET_KEY_PREFIX + storedLogin);
                    if (!storedPat || seenNames.has(storedLogin)) continue;
                    const validity = this._patValidity.get(storedLogin);
                    if (validity && (Date.now() - validity < 10 * 60 * 1000)) {
                        discovered.push({ account: storedLogin, type: 'pat', active: false });
                        seenNames.add(storedLogin);
                        this._tokenCache.set(storedLogin, storedPat);
                        continue;
                    }
                    try {
                        const userRes = await this.verifyPat(storedPat);
                        const login = (userRes && userRes.login) ? userRes.login : storedLogin;
                        if (!seenNames.has(login)) {
                            discovered.push({ account: login, type: 'pat', active: false });
                            seenNames.add(login);
                            this._tokenCache.set(login, storedPat);
                            this._patValidity.set(login, Date.now());
                        }
                    } catch (netErr) {
                        // Offline / unreachable: keep the account from cache.
                        console.warn(`PAT verify unreachable for ${storedLogin}, using cached:`, netErr.message);
                        discovered.push({ account: storedLogin, type: 'pat', active: false });
                        seenNames.add(storedLogin);
                        this._tokenCache.set(storedLogin, storedPat);
                    }
                } catch {}
            }
        } catch {}

        // 3. Check Local GitHub CLI (if installed)
        let cliActive = '';
        try {
            const ghExe = findGhExecutable();
            // Capture both stdout and stderr (fixes BUG-07: gh auth status outputs to stderr and exits with 1 on warnings)
            const rawStatus = await new Promise((resolve) => {
                const { exec } = require('child_process');
                exec(`"${ghExe}" auth status`, { timeout: 7000, windowsHide: true }, (err, stdout, stderr) => {
                    resolve((stdout || '') + '\n' + (stderr || ''));
                });
            });

            // Parse each account section to accurately extract its own token scopes and active state
            const accountBlocks = rawStatus.split(/Logged in to /i).slice(1);
            for (const block of accountBlocks) {
                const nameMatch = block.match(/github\.com account ([A-Za-z0-9_\-.]+)/i);
                if (!nameMatch) continue;
                const acc = nameMatch[1];
                const isActive = /Active account:\s*true/i.test(block);
                const hasCodespaceScope = /Token scopes:[^\n]*'codespace'/i.test(block);

                if (isActive) {
                    cliActive = acc;
                }

                if (!seenNames.has(acc)) {
                    discovered.push({
                        account: acc,
                        type: 'cli',
                        active: isActive,
                        hasCodespaceScope
                    });
                    seenNames.add(acc);
                }
            }

            // Set active from CLI if none persisted or set yet
            if (!this._activeAccount && cliActive) {
                this._activeAccount = cliActive;
            }
        } catch {}

        // Default the active account only when nothing was persisted yet.
        // Never auto-clobber a persisted active account: if it is temporarily
        // undiscoverable (e.g. PAT host offline), keep it so the UI does not flap
        // between accounts on every refresh. It is NOT persisted here either.
        if (!this._activeAccount && discovered.length > 0) {
            this._activeAccount = cliActive && discovered.some(a => a.account === cliActive)
                ? cliActive
                : discovered[0].account;
        }

        // Mark active flag
        for (const item of discovered) {
            item.active = (item.account === this._activeAccount);
        }

        this._accounts = discovered;
        return discovered;
    }

    /**
     * Retrieves an OAuth Bearer token for the given account.
     * Native OAuth tokens are always fetched fresh from VS Code to avoid stale cached tokens.
     */
    async getToken(account) {
        const target = account || this._activeAccount;
        if (!target) return null;

        // For native OAuth: always get fresh from VS Code (handles token refresh automatically)
        try {
            const nativeSession = await vscode.authentication.getSession(
                'github',
                ['repo', 'codespace', 'user'],
                { createIfNone: false }
            );
            if (nativeSession && nativeSession.account.label === target) {
                return nativeSession.accessToken;
            }
        } catch {}

        // For PAT/CLI accounts: use cached token (PATs don't expire unless revoked).
        // NOTE: native OAuth tokens are never served from this cache — they are
        // always fetched fresh from VS Code above, so sign-out can never yield a
        // stale cached OAuth token.
        if (this._tokenCache.has(target)) {
            return this._tokenCache.get(target);
        }

        // Try getting CLI token (stdout-only capture; first whitespace-delimited
        // token, so CLI warnings can never poison the credential).
        try {
            const ghExe = findGhExecutable();
            const raw = await runCommand(ghExe, ['auth', 'token', '-u', target], 6000);
            const cleanToken = (raw || '').split(/\s+/)[0].trim();
            if (cleanToken && cleanToken.length > 10 && !/error|timed out/i.test(cleanToken)) {
                this._tokenCache.set(target, cleanToken);
                return cleanToken;
            }
        } catch {}

        return null;
    }

    /**
     * Primary Login Flow: Native VS Code OAuth with PAT fallback. Zero terminal popups!
     */
    async login() {
        try {
            // 1. Native VS Code OAuth
            const session = await vscode.authentication.getSession(
                'github',
                ['repo', 'codespace', 'user'],
                { createIfNone: true }
            );
            if (session) {
                this.clearCache();
                this._activeAccount = session.account.label;
                // Deliberately NOT caching the OAuth token: getToken() always
                // fetches it fresh from VS Code, which owns refresh/expiry.
                vscode.window.showInformationMessage(`Signed in as ${session.account.label}`);
                this._onAuthChangedEmitter.fire();
                return session.account.label;
            }
        } catch (oauthErr) {
            console.warn('Native OAuth cancelled or failed:', oauthErr.message);
        }

        // 2. Offer PAT fallback for corporate firewalls / proxy setups
        const choice = await vscode.window.showWarningMessage(
            'Sign-in was not completed. You can also connect using a GitHub Personal Access Token (PAT).',
            'Enter PAT',
            'Cancel'
        );

        if (choice === 'Enter PAT') {
            return await this.loginWithPat();
        }
        return null;
    }

    /**
     * Personal Access Token login with validation and context.secrets encrypted storage.
     */
    async loginWithPat() {
        const pat = await vscode.window.showInputBox({
            prompt: 'Enter your GitHub Personal Access Token (classic with repo & codespace scopes, or fine-grained)',
            placeHolder: 'ghp_... or github_pat_...',
            password: true,
            ignoreFocusOut: true,
            validateInput: (val) => {
                if (!val || (!val.startsWith('ghp_') && !val.startsWith('github_pat_') && !val.startsWith('gho_'))) {
                    return 'Token must begin with ghp_, github_pat_, or gho_';
                }
                return null;
            }
        });

        if (!pat) return null;

        const cleanPat = pat.trim();
        let user;
        try {
            user = await this.verifyPat(cleanPat);
        } catch (netErr) {
            vscode.window.showErrorMessage(`Could not reach GitHub: ${netErr.message}`);
            return null;
        }
        if (!user || !user.login) {
            vscode.window.showErrorMessage('Invalid Personal Access Token. Could not authenticate with GitHub.');
            return null;
        }

        // Store PAT under per-account key (fixes: single-key stomping on multi-account)
        await this._context.secrets.store(PAT_SECRET_KEY_PREFIX + user.login, cleanPat);
        // Track this account in the PAT accounts index
        const existing = await this._readPatIndex();
        if (!existing.includes(user.login)) {
            existing.push(user.login);
            await this._writePatIndex(existing);
        }

        // Only remove this account's token from cache (don't nuke OAuth tokens for other accounts)
        this._tokenCache.delete(user.login);
        this._accounts = this._accounts.filter(a => a.account !== user.login);

        // A fresh login becomes the active account.
        this._activeAccount = user.login;
        this._context.globalState?.update('activeAccount', this._activeAccount);
        this._tokenCache.set(user.login, cleanPat);
        this._patValidity.set(user.login, Date.now());
        vscode.window.showInformationMessage(`PAT saved securely. Signed in as ${user.login}`);
        this._onAuthChangedEmitter.fire();
        return user.login;
    }

    /**
     * Verifies token validity against GitHub REST API.
     * Returns the user object, null for rejected credentials, and THROWS for
     * network-level failures so callers can tell "invalid token" from "offline".
     */
    async verifyPat(token) {
        let res;
        try {
            res = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Antigravity-Codespaces'
                },
                signal: AbortSignal.timeout(8000)
            });
        } catch (netErr) {
            throw new Error('GitHub is unreachable. Check your connection, proxy, or firewall.');
        }
        if (res.status === 429) {
            throw new Error('GitHub API rate limit reached. Wait a few minutes and try again.');
        }
        if (!res.ok) return null;
        try {
            return await res.json();
        } catch {
            return null;
        }
    }

    /**
     * Logout and remove stored credentials.
     */
    async logout(account) {
        if (account) {
            this._tokenCache.delete(account);
            this._patValidity.delete(account);
            // Remove per-account PAT secret
            await this._context.secrets.delete(PAT_SECRET_KEY_PREFIX + account).catch(() => {});
            // Remove from PAT accounts index
            const existing = await this._readPatIndex();
            if (existing.includes(account)) {
                await this._writePatIndex(existing.filter(a => a !== account));
            }
            if (this._activeAccount === account) {
                this._activeAccount = '';
                this._context.globalState?.update('activeAccount', undefined);
            }
        } else {
            this._tokenCache.clear();
            this._patValidity.clear();
            // Wipe all stored PAT secrets
            const existingRaw = await this._context.secrets.get(PAT_SECRET_ACCOUNTS_KEY).catch(() => null);
            if (existingRaw) {
                const accounts = await this._readPatIndex();
                for (const acc of accounts) {
                    await this._context.secrets.delete(PAT_SECRET_KEY_PREFIX + acc).catch(() => {});
                }
            }
            // Legacy single-key cleanup
            await this._context.secrets.delete('antigravity_github_pat').catch(() => {});
            await this._context.secrets.delete(PAT_SECRET_ACCOUNTS_KEY).catch(() => {});
            this._activeAccount = '';
            this._context.globalState?.update('activeAccount', undefined);
        }
        this._onAuthChangedEmitter.fire();
        vscode.window.showInformationMessage('Signed out of GitHub.');
    }
}

module.exports = { AuthManager, PAT_SECRET_KEY_PREFIX, PAT_SECRET_ACCOUNTS_KEY };
