const vscode = require('vscode');
const { runCommand } = require('./utils');
const { findGhExecutable } = require('./sshManager');

const PAT_SECRET_KEY = 'antigravity_github_pat';

class AuthManager {
    constructor(context) {
        this._context = context;
        this._tokenCache = new Map();
        this._activeAccount = '';
        this._accounts = [];
        this._onAuthChangedEmitter = new vscode.EventEmitter();
        this.onAuthChanged = this._onAuthChangedEmitter.event;

        // Listen to native VS Code authentication session changes
        context.subscriptions.push(
            vscode.authentication.onDidChangeSessions(e => {
                if (e.provider.id === 'github') {
                    this.clearCache();
                    this._onAuthChangedEmitter.fire();
                }
            })
        );
    }

    clearCache() {
        this._tokenCache.clear();
        this._accounts = [];
    }

    getActiveAccount() {
        return this._activeAccount;
    }

    setActiveAccount(account) {
        this._activeAccount = account;
        this._onAuthChangedEmitter.fire();
    }

    /**
     * Retrieves all authenticated accounts across Native OAuth, Secure PAT, and GitHub CLI.
     */
    async getAccounts() {
        const discovered = [];
        const seenNames = new Set();

        // 1. Check Native VS Code OAuth Session
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
                this._tokenCache.set(name, nativeSession.accessToken);
            }
        } catch {}

        // 2. Check Secure Stored PAT (context.secrets)
        try {
            const storedPat = await this._context.secrets.get(PAT_SECRET_KEY);
            if (storedPat) {
                // Verify PAT against GitHub API /user
                const userRes = await this.verifyPat(storedPat);
                if (userRes && userRes.login && !seenNames.has(userRes.login)) {
                    discovered.push({
                        account: userRes.login,
                        type: 'pat',
                        active: false
                    });
                    seenNames.add(userRes.login);
                    this._tokenCache.set(userRes.login, storedPat);
                }
            }
        } catch {}

        // 3. Check Local GitHub CLI (if installed)
        try {
            const ghExe = findGhExecutable();
            // Capture both stdout and stderr (fixes BUG-07: gh auth status outputs to stderr and exits with 1 on warnings)
            const rawStatus = await new Promise((resolve) => {
                const { exec } = require('child_process');
                exec(`"${ghExe}" auth status`, { timeout: 7000, windowsHide: true }, (err, stdout, stderr) => {
                    resolve((stdout || '') + '\n' + (stderr || ''));
                });
            });

            const cliAccounts = [];
            const re = /Logged in to github\.com account ([A-Za-z0-9_\-]+)/g;
            let m;
            while ((m = re.exec(rawStatus)) !== null) {
                const acc = m[1];
                if (!cliAccounts.includes(acc)) cliAccounts.push(acc);
            }

            const activeMatch = rawStatus.match(/account ([A-Za-z0-9_\-]+)[^\n]*\n[^\n]*Active account:\s*true/);
            const cliActive = activeMatch ? activeMatch[1] : (cliAccounts[0] || '');

            for (const acc of cliAccounts) {
                if (!seenNames.has(acc)) {
                    discovered.push({
                        account: acc,
                        type: 'cli',
                        active: acc === cliActive
                    });
                    seenNames.add(acc);
                }
            }

            // Set active if none selected yet
            if (!this._activeAccount && cliActive) {
                this._activeAccount = cliActive;
            }
        } catch {}

        if (!this._activeAccount && discovered.length > 0) {
            this._activeAccount = discovered[0].account;
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
     */
    async getToken(account) {
        const target = account || this._activeAccount;
        if (!target) return null;

        if (this._tokenCache.has(target)) {
            return this._tokenCache.get(target);
        }

        // Try getting CLI token
        try {
            const ghExe = findGhExecutable();
            const token = await runCommand(ghExe, ['auth', 'token', '-u', target], 6000);
            if (token && !token.includes('error') && !token.includes('Timed out')) {
                const cleanToken = token.trim();
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
                this._tokenCache.set(session.account.label, session.accessToken);
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
                if (!val || (!val.startsWith('ghp_') && !val.startsWith('github_pat_'))) {
                    return 'Token must begin with ghp_ or github_pat_';
                }
                return null;
            }
        });

        if (!pat) return null;

        const cleanPat = pat.trim();
        const user = await this.verifyPat(cleanPat);
        if (!user || !user.login) {
            vscode.window.showErrorMessage('Invalid Personal Access Token. Could not authenticate with GitHub.');
            return null;
        }

        await this._context.secrets.store(PAT_SECRET_KEY, cleanPat);
        this.clearCache();
        this._activeAccount = user.login;
        this._tokenCache.set(user.login, cleanPat);
        vscode.window.showInformationMessage(`PAT saved securely. Signed in as ${user.login}`);
        this._onAuthChangedEmitter.fire();
        return user.login;
    }

    /**
     * Verifies token validity against GitHub REST API.
     */
    async verifyPat(token) {
        try {
            const res = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Antigravity-Codespaces'
                }
            });
            if (res.ok) return await res.json();
        } catch {}
        return null;
    }

    /**
     * Logout and remove stored credentials.
     */
    async logout(account) {
        if (account) {
            this._tokenCache.delete(account);
        } else {
            this._tokenCache.clear();
        }
        await this._context.secrets.delete(PAT_SECRET_KEY);
        this._activeAccount = '';
        this._onAuthChangedEmitter.fire();
        vscode.window.showInformationMessage('Signed out of GitHub.');
    }
}

module.exports = { AuthManager, PAT_SECRET_KEY };
