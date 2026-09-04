const vscode = require('vscode');
const { escapeHtml, generateNonce, formatRelativeTime, I } = require('./utils');
const { SystemDoctor } = require('./systemDoctor');

class SidebarProvider {
    constructor(extensionUri, authManager, githubApi) {
        this._extensionUri = extensionUri;
        this._authManager = authManager;
        this._githubApi = githubApi;
        this._view = null;

        // Auto-refresh when auth changes
        this._authManager.onAuthChanged(() => {
            this.refresh();
        });
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'connect':
                    await vscode.commands.executeCommand('antigravity-codespaces.connect', {
                        codespaceData: { name: msg.name, account: msg.account, repository: msg.repo }
                    });
                    break;
                case 'start':
                    await vscode.commands.executeCommand('antigravity-codespaces.start', {
                        codespaceData: { name: msg.name, account: msg.account }
                    });
                    setTimeout(() => this.refresh(), 2000);
                    break;
                case 'stop':
                    await vscode.commands.executeCommand('antigravity-codespaces.stop', {
                        codespaceData: { name: msg.name, account: msg.account }
                    });
                    setTimeout(() => this.refresh(), 1500);
                    break;
                case 'openWeb':
                    await vscode.commands.executeCommand('antigravity-codespaces.openInBrowser', {
                        codespaceData: { name: msg.name }
                    });
                    break;
                case 'rebuild':
                    await vscode.commands.executeCommand('antigravity-codespaces.rebuild', {
                        codespaceData: { name: msg.name, account: msg.account },
                        full: msg.full
                    });
                    break;
                case 'copySSH':
                    await vscode.commands.executeCommand('antigravity-codespaces.copySSHCommand', {
                        codespaceData: { name: msg.name }
                    });
                    break;
                case 'delete':
                    await vscode.commands.executeCommand('antigravity-codespaces.deleteCodespace', {
                        codespaceData: { name: msg.name, account: msg.account },
                        confirmed: msg.confirmed === true
                    });
                    setTimeout(() => this.refresh(), 1500);
                    break;
                case 'switchAccount':
                    await vscode.commands.executeCommand('antigravity-codespaces.switchAccount', msg.account ? { account: msg.account } : undefined);
                    break;
                case 'createCodespace':
                    await vscode.commands.executeCommand('antigravity-codespaces.createCodespace');
                    break;
                case 'openDashboard':
                    await vscode.commands.executeCommand('antigravity-codespaces.openDashboard');
                    break;
                case 'refresh':
                    await this.refresh();
                    break;
                case 'loginGitHub':
                    await this._authManager.login();
                    break;
                case 'loginPat':
                    await this._authManager.loginWithPat();
                    break;
                case 'openExternal':
                    if (msg.url && msg.url.startsWith('https://')) {
                        vscode.env.openExternal(vscode.Uri.parse(msg.url));
                    }
                    break;
                case 'openPortUrl':
                    if (msg.url && msg.url.startsWith('https://')) {
                        vscode.env.openExternal(vscode.Uri.parse(msg.url));
                    }
                    break;
                case 'testSSH':
                    await vscode.commands.executeCommand('antigravity-codespaces.testSSH', {
                        codespaceData: { name: msg.name, account: msg.account }
                    });
                    break;
                case 'syncAllSSH':
                    await vscode.commands.executeCommand('antigravity-codespaces.syncAllSSH');
                    break;
                case 'promptInstallGh':
                    await SystemDoctor.promptInstallGhCli();
                    break;
                case 'fetchMeta': {
                    try {
                        const meta = await this._githubApi.fetchMeta(msg.name, msg.account);
                        const ports = await this._githubApi.fetchPorts(msg.name, msg.account);
                        this._view?.webview.postMessage({ command: 'metaLoaded', name: msg.name, meta, ports });
                    } catch (err) {
                        this._view?.webview.postMessage({ command: 'metaError', name: msg.name, error: err.message || 'could not load details' });
                    }
                    break;
                }
                default:
                    console.warn(`SidebarProvider: unknown webview command "${msg && msg.command}" — ignored.`);
                    break;
            }
        });

        this.render();
    }

    async refresh() {
        this._githubApi.clearCache();
        await this.render();
    }

    async render() {
        if (!this._view) return;
        try {
            const accounts = await this._authManager.getAccounts();
            if (accounts.length === 0) {
                const diag = await SystemDoctor.diagnose(this._authManager);
                this._view.webview.html = this.buildWelcomeHtml(diag);
                return;
            }

            const activeAccount = this._authManager.getActiveAccount() || accounts[0].account;
            try {
                const codespaces = await this._githubApi.listCodespaces(activeAccount);
                this._view.webview.html = this.buildSidebarHtml(accounts, activeAccount, codespaces);
            } catch (fetchErr) {
                this._view.webview.html = this.buildSidebarHtml(accounts, activeAccount, [], fetchErr.message);
            }
        } catch (err) {
            const diag = await SystemDoctor.diagnose(this._authManager).catch(() => ({}));
            this._view.webview.html = this.buildWelcomeHtml(diag);
        }
    }

    /**
     * Screen 1: Unauthenticated (Welcome Screen)
     * Matching approved visual reference image & design specification.
     */
    buildWelcomeHtml(diag) {
        const nonce = generateNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Antigravity Codespaces</title>
<style nonce="${nonce}">
*, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}
body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
    font-size: var(--vscode-font-size, 12px);
    color: var(--vscode-foreground, #1f2328);
    background: transparent;
    padding: 14px 12px 24px;
    user-select: none;
    -webkit-user-select: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow-x: hidden;
}
.welcome-wrap {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
}
.hero-illustration {
    margin: 8px 0 12px;
    display: flex;
    align-items: center;
    justify-content: center;
}
.hero-illustration-svg {
    max-width: 140px;
    height: auto;
}
.welcome-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--vscode-foreground);
    letter-spacing: -0.2px;
    margin-bottom: 8px;
}
.quota-pill {
    display: inline-flex;
    align-items: center;
    background: rgba(31, 111, 235, 0.1);
    color: var(--vscode-textLink-foreground, #0969da);
    border: 1px solid rgba(31, 111, 235, 0.25);
    border-radius: 20px;
    padding: 3px 12px;
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 12px;
}
.welcome-desc {
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--vscode-descriptionForeground, #656d76);
    max-width: 290px;
    margin-bottom: 18px;
}
.btn-primary-auth {
    width: 100%;
    padding: 9px 14px;
    background: var(--vscode-button-background, #0969da);
    color: var(--vscode-button-foreground, #ffffff);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: background 0.15s ease, transform 0.05s ease;
    min-height: 34px;
}
.btn-primary-auth:hover {
    background: var(--vscode-button-hoverBackground, #085cc0);
}
.btn-primary-auth:active {
    transform: scale(0.99);
}
.btn-secondary-auth {
    width: 100%;
    padding: 8px 14px;
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-button-secondaryBorder, rgba(128, 128, 128, 0.25));
    border-radius: 6px;
    cursor: pointer;
    font-size: 11.5px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 8px;
    transition: background 0.15s ease;
    min-height: 32px;
}
.btn-secondary-auth:hover {
    background: rgba(128, 128, 128, 0.08);
}
.signup-link-wrap {
    margin-top: 12px;
}
.signup-link {
    font-size: 11px;
    color: var(--vscode-textLink-foreground, #0969da);
    text-decoration: none;
    cursor: pointer;
    transition: text-decoration 0.15s;
}
.signup-link:hover {
    text-decoration: underline;
}

/* Checklist Card */
.diag-card {
    width: 100%;
    margin-top: 22px;
    background: var(--vscode-sideBarSectionHeader-background, rgba(128, 128, 128, 0.05));
    border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.14));
    border-radius: 8px;
    padding: 12px 14px;
    text-align: left;
}
.diag-card-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--vscode-foreground);
    margin-bottom: 10px;
    letter-spacing: 0.1px;
}
.diag-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 5px 0;
    font-size: 11px;
}
.diag-icon {
    flex-shrink: 0;
    margin-top: 1px;
    display: flex;
    align-items: center;
}
.diag-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.diag-label {
    font-weight: 500;
    color: var(--vscode-foreground);
    line-height: 1.3;
}
.diag-substatus {
    font-size: 10.5px;
    font-weight: 500;
    margin-top: 1px;
}
.status-ok {
    color: #2ea043;
}
.status-warn {
    color: #d29922;
}
.diag-install-link {
    margin-top: 8px;
    padding-left: 22px;
}
</style>
</head>
<body>
    <div class="welcome-wrap">
        <div class="hero-illustration">
            ${I.cloudHero}
        </div>

        <h1 class="welcome-title">Antigravity Codespaces</h1>
        <div class="quota-pill">60 free compute hrs / month</div>
        <p class="welcome-desc">
            Connect, launch, and manage full cloud developer containers directly inside Antigravity IDE.
        </p>

        <button class="btn-primary-auth" id="loginBtn" aria-label="Sign In with GitHub">
            ${I.github}
            <span>Sign In with GitHub</span>
        </button>

        <button class="btn-secondary-auth" id="patBtn" aria-label="Use Personal Access Token">
            ${I.shield}
            <span>Use Personal Access Token (PAT)</span>
        </button>

        <div class="signup-link-wrap">
            <a class="signup-link" id="signupLink">Don't have an account? Create one free &rarr;</a>
        </div>

        <div class="diag-card">
            <div class="diag-card-title">System Health Checklist</div>

            <div class="diag-item">
                <span class="diag-icon">${diag.ghInstalled ? I.checkCircle : I.alertTriangle}</span>
                <div class="diag-content">
                    <span class="diag-label">GitHub CLI (SSH Tunnels)</span>
                    <span class="diag-substatus ${diag.ghInstalled ? 'status-ok' : 'status-warn'}">
                        ${diag.ghInstalled ? 'Installed' : 'Missing'}
                    </span>
                </div>
            </div>

            <div class="diag-item">
                <span class="diag-icon">${diag.hasOpenSsh ? I.checkCircle : I.alertTriangle}</span>
                <div class="diag-content">
                    <span class="diag-label">OpenSSH Client</span>
                    <span class="diag-substatus ${diag.hasOpenSsh ? 'status-ok' : 'status-warn'}">
                        ${diag.hasOpenSsh ? 'Available' : 'Missing'}
                    </span>
                </div>
            </div>

            <div class="diag-item">
                <span class="diag-icon">${diag.hasRemoteSsh ? I.checkCircle : I.alertTriangle}</span>
                <div class="diag-content">
                    <span class="diag-label">Remote SSH Extension</span>
                    <span class="diag-substatus ${diag.hasRemoteSsh ? 'status-ok' : 'status-warn'}">
                        ${diag.hasRemoteSsh ? 'Detected' : 'Recommended'}
                    </span>
                </div>
            </div>

            ${!diag.ghInstalled ? `
            <div class="diag-install-link">
                <a class="signup-link" id="installGhLink">Install GitHub CLI &rarr;</a>
            </div>` : ''}
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.getElementById('loginBtn').addEventListener('click', () => vscode.postMessage({ command: 'loginGitHub' }));
        document.getElementById('patBtn').addEventListener('click', () => vscode.postMessage({ command: 'loginPat' }));
        document.getElementById('signupLink').addEventListener('click', () => vscode.postMessage({ command: 'openExternal', url: 'https://github.com/signup' }));
        const ghLink = document.getElementById('installGhLink');
        if (ghLink) ghLink.addEventListener('click', () => vscode.postMessage({ command: 'promptInstallGh' }));
    </script>
</body>
</html>`;
    }

    /**
     * Screens 2, 3, 4, 5, 6, 7, 8: Authenticated Sidebar UI
     * Handles List, Card expansion, Empty, Error, Search, and In-Webview Modals.
     */
    buildSidebarHtml(accounts, activeAccount, codespaces, errorMsg = '') {
        const nonce = generateNonce();

        const csListHtml = codespaces.map(cs => {
            const isRunning = cs.state === 'Available';
            const branch = cs.gitStatus?.ref || '—';
            const repoShort = (cs.repository || cs.name).split('/').pop() || cs.name;
            const fullRepo = cs.repository || cs.name;
            const name = cs.displayName || cs.name;

            return `
            <article class="cs-card ${isRunning ? 'is-running' : 'is-stopped'}" id="card-${escapeHtml(cs.name)}" data-name="${escapeHtml(cs.name.toLowerCase())}" data-repo="${escapeHtml((cs.repository || '').toLowerCase())}" data-branch="${escapeHtml(branch.toLowerCase())}">
                <!-- Card Header: Status + Title + Action Controls -->
                <header class="cs-card-header">
                    <div class="cs-header-left" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account || activeAccount)}" title="Click to toggle details">
                        <div class="cs-status-indicator">
                            <span class="status-dot ${isRunning ? 'is-online' : 'is-offline'}"></span>
                            <span class="status-text ${isRunning ? 'text-running' : 'text-stopped'}">${isRunning ? 'Running' : 'Stopped'}</span>
                        </div>
                        <h2 class="cs-name" title="${escapeHtml(name)}">${escapeHtml(name)}</h2>
                    </div>

                    <div class="cs-actions-group">
                        <button class="act-btn btn-connect" data-act="connect" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account || activeAccount)}" data-repo="${escapeHtml(cs.repository)}" title="Connect in Antigravity IDE" aria-label="Connect">
                            ${I.play}
                        </button>
                        ${isRunning ? `
                        <button class="act-btn btn-stop" data-act="stop" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account || activeAccount)}" title="Stop Codespace (save hours)" aria-label="Stop Codespace">
                            ${I.stop}
                        </button>` : `
                        <button class="act-btn btn-start" data-act="start" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account || activeAccount)}" title="Turn ON Codespace" aria-label="Turn ON Codespace">
                            ${I.power}
                        </button>`}
                        <button class="act-btn btn-globe" data-act="openWeb" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account || activeAccount)}" title="Open in GitHub Web" aria-label="Open in Web">
                            ${I.globe}
                        </button>
                        <button class="act-btn btn-chevron" data-act="toggle" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account || activeAccount)}" title="Toggle Details" aria-label="Toggle Details">
                            ${I.chevronDown}
                        </button>
                    </div>
                </header>

                <!-- Sub-row: Repository + Branch -->
                <div class="cs-meta-row" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account || activeAccount)}" title="Click to toggle details">
                    <div class="cs-meta-item" title="Repository: ${escapeHtml(fullRepo)}">
                        <span class="meta-ico">${I.repo}</span>
                        <span class="meta-txt">${escapeHtml(fullRepo)}</span>
                    </div>
                    <div class="cs-meta-item cs-branch-item" title="Branch: ${escapeHtml(branch)}">
                        <span class="meta-ico">${I.branch}</span>
                        <span class="meta-txt branch-txt">${escapeHtml(branch)}</span>
                    </div>
                </div>

                <!-- Expanded Details Drawer (Screen 3) -->
                <div class="cs-details" id="details-${escapeHtml(cs.name)}">
                    <div class="details-inner" id="inner-${escapeHtml(cs.name)}">
                        <div class="loading-meta">Loading machine specs & ports...</div>
                    </div>
                </div>
            </article>`;
        }).join('');

        // Account list items for in-webview Account Switcher Modal (Screen 6)
        const accountModalRows = accounts.map(acc => {
            const isActive = acc.account === activeAccount;
            let typeLabel = 'GitHub CLI';
            if (acc.type === 'native') typeLabel = 'GitHub OAuth';
            if (acc.type === 'pat') typeLabel = 'PAT';

            return `
            <div class="modal-account-row ${isActive ? 'is-active' : ''}" data-acc="${escapeHtml(acc.account)}">
                <div class="acc-avatar-wrap">
                    <img class="acc-avatar-img" src="https://github.com/${encodeURIComponent(acc.account)}.png?size=64" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="acc-avatar-fallback" style="display:none;">${escapeHtml(acc.account.slice(0, 2).toUpperCase())}</div>
                </div>
                <div class="acc-details-text">
                    <div class="acc-main-name">
                        <span class="name-bold">${escapeHtml(acc.account)}</span>
                        ${isActive ? '<span class="active-badge">(Active)</span>' : ''}
                    </div>
                    <div class="acc-sub-text">Signed in via ${typeLabel}</div>
                </div>
                ${isActive ? `<span class="acc-check-icon">${I.check}</span>` : ''}
            </div>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GitHub Codespaces</title>
<style nonce="${nonce}">
*, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}
body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
    font-size: var(--vscode-font-size, 12px);
    color: var(--vscode-sideBar-foreground, var(--vscode-foreground, #1f2328));
    background: transparent;
    padding: 8px 10px 20px;
    user-select: none;
    -webkit-user-select: none;
    overflow-x: hidden;
    max-width: 480px;
    margin: 0 auto;
}

/* ── Top Account Banner (Screen 2) ── */
.top-account-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: var(--vscode-sideBarSectionHeader-background, rgba(128, 128, 128, 0.05));
    border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.12));
    border-radius: 8px;
    padding: 5px 8px;
    margin-bottom: 8px;
}
.account-selector {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    cursor: pointer;
    flex: 1;
}
.user-avatar-wrap {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    background: rgba(128, 128, 128, 0.15);
    display: flex;
    align-items: center;
    justify-content: center;
}
.user-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.user-avatar-fallback {
    font-size: 9px;
    font-weight: 700;
    color: var(--vscode-foreground);
}
.account-username {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.account-chevron {
    color: var(--vscode-descriptionForeground, #656d76);
    display: flex;
    align-items: center;
    flex-shrink: 0;
}
.btn-switch-account {
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-button-secondaryBorder, rgba(128, 128, 128, 0.2));
    border-radius: 5px;
    padding: 3px 9px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease;
    flex-shrink: 0;
}
.btn-switch-account:hover {
    background: rgba(128, 128, 128, 0.12);
}

/* ── Search Bar (Screen 2) ── */
.search-wrapper {
    position: relative;
    margin-bottom: 8px;
}
.search-input {
    width: 100%;
    background: var(--vscode-input-background, rgba(128, 128, 128, 0.05));
    color: var(--vscode-input-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.18));
    border-radius: 6px;
    padding: 6px 8px 6px 28px;
    font-size: 11.5px;
    outline: none;
    transition: border-color 0.15s;
}
.search-input:focus {
    border-color: var(--vscode-focusBorder, #0969da);
}
.search-icon-decor {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground, #8c959f));
    pointer-events: none;
    display: flex;
}

/* ── Codespace Card (Screen 2 & 3) ── */
.cs-card {
    background: var(--vscode-sideBarSectionHeader-background, rgba(128, 128, 128, 0.04));
    border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.12));
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 7px;
    transition: border-color 0.15s ease, background 0.15s ease;
}
.cs-card:hover {
    background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08));
    border-color: rgba(9, 105, 218, 0.25);
}
.cs-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
}
.cs-header-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
    cursor: pointer;
}
.cs-status-indicator {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    font-weight: 500;
}
.status-dot {
    width: 6.5px;
    height: 6.5px;
    border-radius: 50%;
    flex-shrink: 0;
}
.status-dot.is-online {
    background: #2ea043;
    box-shadow: 0 0 0 1.5px rgba(46, 160, 67, 0.25);
}
.status-dot.is-offline {
    background: var(--vscode-descriptionForeground, #6e7681);
}
.status-text.text-running {
    color: #2ea043;
}
.status-text.text-stopped {
    color: var(--vscode-descriptionForeground, #6e7681);
}
.cs-name {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--vscode-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.1px;
}
.cs-actions-group {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
}
.act-btn {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: none;
    outline: none;
    background: transparent;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--vscode-foreground);
    transition: background 0.15s ease;
}
.act-btn:hover {
    background: rgba(128, 128, 128, 0.15);
}
.act-btn:focus-visible {
    outline: 1.5px solid var(--vscode-focusBorder, #0969da);
}
.btn-connect {
    color: #0969da;
}
.btn-connect:hover {
    background: rgba(9, 105, 218, 0.12);
}
.btn-stop {
    color: #cf222e;
}
.btn-stop:hover {
    background: rgba(207, 34, 46, 0.12);
}
.btn-start {
    color: #2ea043;
}
.btn-start:hover {
    background: rgba(46, 160, 67, 0.12);
}
.btn-globe {
    color: #0969da;
}
.btn-globe:hover {
    background: rgba(9, 105, 218, 0.12);
}
.btn-chevron {
    color: var(--vscode-descriptionForeground, #656d76);
}
.cs-card.is-expanded .btn-chevron svg {
    transform: rotate(180deg);
}
.btn-chevron svg {
    transition: transform 0.18s ease;
}

/* ── Card Sub-Row (Metadata) ── */
.cs-meta-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 5px;
    cursor: pointer;
}
.cs-meta-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #656d76);
    overflow: hidden;
}
.meta-ico {
    display: flex;
    flex-shrink: 0;
    color: var(--vscode-descriptionForeground, #8c959f);
}
.meta-txt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.branch-txt {
    font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, monospace);
    font-size: 10px;
}

/* ── Expanded Details Drawer (Screen 3) ── */
.cs-details {
    display: none;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.15));
    font-size: 11px;
}
.cs-card.is-expanded .cs-details {
    display: block;
}
.details-inner {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.meta-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #656d76);
}
.meta-row svg {
    flex-shrink: 0;
    color: var(--vscode-descriptionForeground, #8c959f);
}
.meta-label {
    font-weight: 500;
}
.meta-val {
    color: var(--vscode-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.loading-meta {
    font-style: italic;
    color: var(--vscode-descriptionForeground, #8c959f);
    padding: 4px 0;
}

/* Forwarded Ports */
.ports-container {
    margin-top: 3px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.ports-heading {
    font-weight: 600;
    color: var(--vscode-foreground);
    margin-bottom: 2px;
}
.port-item-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 4px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vscode-foreground);
    transition: background 0.1s;
}
.port-item-row:hover {
    background: rgba(128, 128, 128, 0.08);
}
.port-info-left {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
}
.port-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
}
.port-dot.port-online { background: #2ea043; }
.port-dot.port-offline { background: var(--vscode-descriptionForeground, #6e7681); }
.port-vis {
    color: var(--vscode-descriptionForeground, #656d76);
    font-size: 10.5px;
}
.port-ext-ico {
    color: var(--vscode-textLink-foreground, #0969da);
    display: flex;
}

/* 2x2 Action Button Grid */
.detail-actions-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 6px;
}
.grid-btn {
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-button-secondaryBorder, rgba(128, 128, 128, 0.18));
    border-radius: 5px;
    padding: 5px 8px;
    font-size: 10.5px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    transition: background 0.15s ease;
    min-height: 28px;
}
.grid-btn:hover {
    background: rgba(128, 128, 128, 0.12);
}
.grid-btn.btn-danger {
    color: #cf222e;
    border-color: rgba(207, 34, 46, 0.25);
    background: rgba(207, 34, 46, 0.04);
}
.grid-btn.btn-danger:hover {
    background: rgba(207, 34, 46, 0.12);
}

/* ── Screen 4: Empty State ── */
.empty-state-view {
    text-align: center;
    padding: 30px 16px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    color: var(--vscode-foreground);
}
.empty-hero-icon {
    color: var(--vscode-descriptionForeground, #8c959f);
    margin-bottom: 12px;
}
.empty-title {
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 6px;
}
.empty-desc {
    font-size: 11px;
    line-height: 1.45;
    color: var(--vscode-descriptionForeground, #656d76);
    max-width: 240px;
    margin-bottom: 16px;
}
.empty-link-inline {
    color: var(--vscode-textLink-foreground, #0969da);
    text-decoration: underline;
    cursor: pointer;
}
.btn-primary-create {
    padding: 7px 14px;
    background: var(--vscode-button-background, #0969da);
    color: var(--vscode-button-foreground, #ffffff);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11.5px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background 0.15s;
}
.btn-primary-create:hover {
    background: var(--vscode-button-hoverBackground, #085cc0);
}

/* ── Screen 5: Error State ── */
.error-state-card {
    background: rgba(207, 34, 46, 0.05);
    border: 1px solid rgba(207, 34, 46, 0.25);
    border-radius: 8px;
    padding: 14px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 4px;
}
.error-icon-circle {
    margin-bottom: 8px;
    display: flex;
}
.error-headline {
    font-size: 12.5px;
    font-weight: 700;
    color: #cf222e;
    margin-bottom: 4px;
}
.error-subtext {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #656d76);
    margin-bottom: 12px;
    word-break: break-word;
}
.btn-retry {
    padding: 5px 14px;
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-button-secondaryBorder, rgba(128, 128, 128, 0.25));
    border-radius: 5px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background 0.15s;
}
.btn-retry:hover {
    background: rgba(128, 128, 128, 0.1);
}

/* ── In-Webview Modal Overlays (Screens 6, 7, 8) ── */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
    display: none;
    align-items: center;
    justify-content: center;
    padding: 14px;
    z-index: 1000;
}
.modal-overlay.active {
    display: flex;
}
.modal-card {
    background: var(--vscode-sideBar-background, var(--vscode-editor-background, #ffffff));
    border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.2));
    border-radius: 10px;
    width: 100%;
    max-width: 320px;
    padding: 14px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    position: relative;
}
.modal-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
}
.modal-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--vscode-foreground);
}
.modal-close-btn {
    background: transparent;
    border: none;
    color: var(--vscode-descriptionForeground, #656d76);
    cursor: pointer;
    display: flex;
    padding: 3px;
    border-radius: 4px;
}
.modal-close-btn:hover {
    background: rgba(128, 128, 128, 0.12);
}
.modal-desc {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #656d76);
    margin-bottom: 12px;
    line-height: 1.4;
}

/* Rebuild Options (Screen 7) */
.rebuild-option-box {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.18));
    border-radius: 7px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
    text-align: left;
}
.rebuild-option-box:hover {
    background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08));
    border-color: var(--vscode-focusBorder, #0969da);
}
.rebuild-ico {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(9, 105, 218, 0.1);
    color: #0969da;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.rebuild-ico.ico-danger {
    background: rgba(207, 34, 46, 0.1);
    color: #cf222e;
}
.rebuild-txt-col {
    display: flex;
    flex-direction: column;
}
.rebuild-opt-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-foreground);
}
.rebuild-opt-desc {
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground, #656d76);
    line-height: 1.35;
    margin-top: 2px;
}

/* Delete Confirmation (Screen 8) */
.delete-center-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    margin: 8px 0 14px;
}
.delete-badge-circle {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(207, 34, 46, 0.1);
    color: #cf222e;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 10px;
}
.delete-badge-circle svg {
    width: 20px;
    height: 20px;
}
.delete-confirm-title {
    font-size: 13.5px;
    font-weight: 700;
    color: var(--vscode-foreground);
    margin-bottom: 4px;
}
.delete-confirm-sub {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #656d76);
}
.modal-actions-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
}
.btn-modal-cancel {
    padding: 6px 12px;
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-button-secondaryBorder, rgba(128, 128, 128, 0.2));
    border-radius: 5px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
}
.btn-modal-cancel:hover {
    background: rgba(128, 128, 128, 0.1);
}
.btn-modal-danger {
    padding: 6px 14px;
    background: #cf222e;
    color: #ffffff;
    border: none;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
}
.btn-modal-danger:hover {
    background: #a40e26;
}

/* Account Switcher Modal (Screen 6) */
.modal-account-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
    border-radius: 6px;
    cursor: pointer;
    margin-bottom: 4px;
    transition: background 0.1s;
}
.modal-account-row:hover {
    background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08));
}
.modal-account-row.is-active {
    background: rgba(9, 105, 218, 0.08);
}
.acc-avatar-wrap {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    overflow: hidden;
    background: rgba(128, 128, 128, 0.15);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}
.acc-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.acc-avatar-fallback {
    font-size: 10px;
    font-weight: 700;
    color: var(--vscode-foreground);
}
.acc-details-text {
    flex: 1;
    min-width: 0;
    text-align: left;
}
.acc-main-name {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
}
.name-bold {
    font-weight: 600;
    color: var(--vscode-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.active-badge {
    color: var(--vscode-descriptionForeground, #656d76);
    font-size: 10px;
}
.acc-sub-text {
    font-size: 10px;
    color: var(--vscode-descriptionForeground, #656d76);
}
.acc-check-icon {
    color: #0969da;
    display: flex;
    flex-shrink: 0;
}
.modal-divider {
    height: 1px;
    background: var(--vscode-sideBarSectionHeader-border, rgba(128, 128, 128, 0.15));
    margin: 8px 0;
}
.modal-action-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
    color: var(--vscode-foreground);
    transition: background 0.1s;
}
.modal-action-row:hover {
    background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08));
}
.modal-action-row svg {
    color: var(--vscode-descriptionForeground, #656d76);
    flex-shrink: 0;
}
</style>
</head>
<body>

    <!-- Top Account Banner (Screen 2) -->
    <div class="top-account-bar">
        <div class="account-selector" id="accountSelectorBtn" title="Current Active GitHub Account: ${escapeHtml(activeAccount)}">
            <div class="user-avatar-wrap">
                <img class="user-avatar-img" src="https://github.com/${encodeURIComponent(activeAccount)}.png?size=64" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="user-avatar-fallback" style="display:none;">${escapeHtml(activeAccount.slice(0, 2).toUpperCase())}</div>
            </div>
            <span class="account-username">${escapeHtml(activeAccount)}</span>
            <span class="account-chevron">${I.chevronDown}</span>
        </div>
        <button class="btn-switch-account" id="switchAccBtn" title="Switch Account">Switch</button>
    </div>

    <!-- Search Bar (Screen 2) -->
    <div class="search-wrapper">
        <span class="search-icon-decor">${I.search}</span>
        <input class="search-input" id="searchBox" type="text" placeholder="Search Codespaces..." autocomplete="off">
    </div>

    <!-- Main Content: Error / Empty / Cards List -->
    ${errorMsg ? `
    <!-- Screen 5: Error State -->
    <div class="error-state-card" id="errorView">
        <span class="error-icon-circle">${I.alertCircle}</span>
        <div class="error-headline">Failed to load Codespaces:</div>
        <div class="error-subtext">${escapeHtml(errorMsg)}</div>
        <button class="btn-retry" id="retryBtn">
            ${I.refresh}
            <span>Retry</span>
        </button>
    </div>
    ` : codespaces.length === 0 ? `
    <!-- Screen 4: Empty State -->
    <div class="empty-state-view" id="emptyView">
        <div class="empty-hero-icon">${I.emptyHero}</div>
        <div class="empty-title">No Codespaces found.</div>
        <div class="empty-desc">
            <a class="empty-link-inline" id="emptyCreateLink">Create</a> a new Codespace to get started with cloud development.
        </div>
        <button class="btn-primary-create" id="emptyCreateBtn">
            ${I.plus}
            <span>Create New Codespace</span>
        </button>
    </div>
    ` : `
    <!-- Screen 2: Codespace List -->
    <div id="csList">
        ${csListHtml}
    </div>
    <div id="noMatchView" class="empty-state-view" style="display:none; padding:20px 8px;">
        <div class="empty-title" style="font-size:12.5px;">No matching Codespaces found.</div>
    </div>
    `}

    <!-- ── In-Webview Modal: Rebuild Options (Screen 7) ── -->
    <div class="modal-overlay" id="rebuildModal">
        <div class="modal-card">
            <div class="modal-header-row">
                <span class="modal-title">Rebuild Codespace</span>
                <button class="modal-close-btn" id="closeRebuildModal" aria-label="Close">${I.close}</button>
            </div>
            <div class="modal-desc" id="rebuildTargetDesc">Choose the type of rebuild.</div>

            <div class="rebuild-option-box" id="optStandardRebuild">
                <span class="rebuild-ico">${I.refresh}</span>
                <div class="rebuild-txt-col">
                    <span class="rebuild-opt-title">Standard Rebuild</span>
                    <span class="rebuild-opt-desc">Rebuild the dev container using existing configuration.</span>
                </div>
            </div>

            <div class="rebuild-option-box" id="optFullRebuild">
                <span class="rebuild-ico ico-danger">${I.trash}</span>
                <div class="rebuild-txt-col">
                    <span class="rebuild-opt-title">Full Clean Rebuild</span>
                    <span class="rebuild-opt-desc">Rebuild from scratch (deletes container, rebuilds everything).</span>
                </div>
            </div>

            <div class="modal-actions-row">
                <button class="btn-modal-cancel" id="cancelRebuildBtn">Cancel</button>
            </div>
        </div>
    </div>

    <!-- ── In-Webview Modal: Delete Confirmation (Screen 8) ── -->
    <div class="modal-overlay" id="deleteModal">
        <div class="modal-card">
            <div class="modal-header-row">
                <span class="modal-title">Delete Codespace?</span>
                <button class="modal-close-btn" id="closeDeleteModal" aria-label="Close">${I.close}</button>
            </div>

            <div class="delete-center-content">
                <div class="delete-badge-circle">${I.trash}</div>
                <div class="delete-confirm-title" id="deleteTargetTitle">Delete Codespace?</div>
                <div class="delete-confirm-sub">This is permanent and cannot be undone.</div>
            </div>

            <div class="modal-actions-row">
                <button class="btn-modal-cancel" id="cancelDeleteBtn">Cancel</button>
                <button class="btn-modal-danger" id="confirmDeleteBtn">Delete</button>
            </div>
        </div>
    </div>

    <!-- ── In-Webview Modal: Account Switcher (Screen 6) ── -->
    <div class="modal-overlay" id="accountModal">
        <div class="modal-card">
            <div class="modal-header-row">
                <span class="modal-title">Switch GitHub account</span>
                <button class="modal-close-btn" id="closeAccountModal" aria-label="Close">${I.close}</button>
            </div>

            <div class="modal-account-list">
                ${accountModalRows}
            </div>

            <div class="modal-divider"></div>

            <div class="modal-action-row" id="addOauthRow">
                <span>${I.key}</span>
                <span>Sign In with another GitHub Account</span>
            </div>
            <div class="modal-action-row" id="addPatRow">
                <span>${I.shield}</span>
                <span>Add Personal Access Token (PAT)</span>
            </div>

            <div class="modal-actions-row">
                <button class="btn-modal-cancel" id="cancelAccountBtn">Cancel</button>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // ── Search & Filter ──
    const searchBox = document.getElementById('searchBox');
    if (searchBox) {
        searchBox.addEventListener('input', () => {
            const q = (searchBox.value || '').trim().toLowerCase();
            const cards = document.querySelectorAll('.cs-card');
            let matchCount = 0;
            cards.forEach(c => {
                const name = c.getAttribute('data-name') || '';
                const repo = c.getAttribute('data-repo') || '';
                const branch = c.getAttribute('data-branch') || '';
                const match = !q || name.includes(q) || repo.includes(q) || branch.includes(q);
                c.style.display = match ? '' : 'none';
                if (match) matchCount++;
            });

            const noMatch = document.getElementById('noMatchView');
            if (noMatch) {
                noMatch.style.display = (cards.length > 0 && matchCount === 0) ? 'block' : 'none';
            }
        });
    }

    // ── Retry Button (Error state) ──
    const retryBtn = document.getElementById('retryBtn');
    if (retryBtn) {
        retryBtn.addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
    }

    // ── Empty State Create Actions ──
    const emptyBtn = document.getElementById('emptyCreateBtn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => vscode.postMessage({ command: 'createCodespace' }));
    const emptyLink = document.getElementById('emptyCreateLink');
    if (emptyLink) emptyLink.addEventListener('click', () => vscode.postMessage({ command: 'createCodespace' }));

    // ── Account Switcher Modal Triggers (Screen 6) ──
    const accountModal = document.getElementById('accountModal');
    function openAccountModal() { accountModal.classList.add('active'); }
    function closeAccountModal() { accountModal.classList.remove('active'); }

    document.getElementById('switchAccBtn')?.addEventListener('click', openAccountModal);
    document.getElementById('accountSelectorBtn')?.addEventListener('click', openAccountModal);
    document.getElementById('closeAccountModal')?.addEventListener('click', closeAccountModal);
    document.getElementById('cancelAccountBtn')?.addEventListener('click', closeAccountModal);

    document.querySelectorAll('.modal-account-row').forEach(row => {
        row.addEventListener('click', () => {
            const acc = row.getAttribute('data-acc');
            closeAccountModal();
            if (acc) vscode.postMessage({ command: 'switchAccount', account: acc });
        });
    });
    document.getElementById('addOauthRow')?.addEventListener('click', () => {
        closeAccountModal();
        vscode.postMessage({ command: 'loginGitHub' });
    });
    document.getElementById('addPatRow')?.addEventListener('click', () => {
        closeAccountModal();
        vscode.postMessage({ command: 'loginPat' });
    });

    // ── Rebuild Modal State (Screen 7) ──
    const rebuildModal = document.getElementById('rebuildModal');
    let rebuildTarget = null;
    function openRebuildModal(name, account) {
        rebuildTarget = { name, account };
        document.getElementById('rebuildTargetDesc').textContent = 'Choose the type of rebuild for "' + name + '".';
        rebuildModal.classList.add('active');
    }
    function closeRebuildModal() {
        rebuildModal.classList.remove('active');
        rebuildTarget = null;
    }
    document.getElementById('closeRebuildModal')?.addEventListener('click', closeRebuildModal);
    document.getElementById('cancelRebuildBtn')?.addEventListener('click', closeRebuildModal);
    document.getElementById('optStandardRebuild')?.addEventListener('click', () => {
        if (rebuildTarget) {
            vscode.postMessage({ command: 'rebuild', name: rebuildTarget.name, account: rebuildTarget.account, full: false });
        }
        closeRebuildModal();
    });
    document.getElementById('optFullRebuild')?.addEventListener('click', () => {
        if (rebuildTarget) {
            vscode.postMessage({ command: 'rebuild', name: rebuildTarget.name, account: rebuildTarget.account, full: true });
        }
        closeRebuildModal();
    });

    // ── Delete Modal State (Screen 8) ──
    const deleteModal = document.getElementById('deleteModal');
    let deleteTarget = null;
    function openDeleteModal(name, account) {
        deleteTarget = { name, account };
        document.getElementById('deleteTargetTitle').textContent = 'Delete "' + name + '"?';
        deleteModal.classList.add('active');
    }
    function closeDeleteModal() {
        deleteModal.classList.remove('active');
        deleteTarget = null;
    }
    document.getElementById('closeDeleteModal')?.addEventListener('click', closeDeleteModal);
    document.getElementById('cancelDeleteBtn')?.addEventListener('click', closeDeleteModal);
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', () => {
        if (deleteTarget) {
            vscode.postMessage({ command: 'delete', name: deleteTarget.name, account: deleteTarget.account, confirmed: true });
        }
        closeDeleteModal();
    });

    // Close modals on Escape key
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAccountModal();
            closeRebuildModal();
            closeDeleteModal();
        }
    });

    // ── Card Interaction Delegation ──
    document.addEventListener('click', (ev) => {
        // Quick Action Buttons
        const actBtn = ev.target.closest('.act-btn');
        if (actBtn) {
            ev.stopPropagation();
            const act = actBtn.dataset.act;
            const name = actBtn.dataset.cs;
            const account = actBtn.dataset.acc;
            const repo = actBtn.dataset.repo;

            if (act === 'toggle') {
                toggleCardDetails(name, account);
                return;
            }
            vscode.postMessage({ command: act, name, account, repo });
            return;
        }

        // Card Title or Meta click -> toggle details drawer
        const toggleWrap = ev.target.closest('.cs-header-left, .cs-meta-row');
        if (toggleWrap) {
            const name = toggleWrap.dataset.cs;
            const account = toggleWrap.dataset.acc;
            toggleCardDetails(name, account);
            return;
        }
    });

    const loadedMeta = new Set();
    function toggleCardDetails(name, account) {
        const card = document.getElementById('card-' + name);
        if (!card) return;
        const isExpanded = card.classList.contains('is-expanded');
        if (isExpanded) {
            card.classList.remove('is-expanded');
        } else {
            card.classList.add('is-expanded');
            if (!loadedMeta.has(name)) {
                loadedMeta.add(name);
                vscode.postMessage({ command: 'fetchMeta', name, account });
            }
        }
    }

    // ── Metadata Loaded Message Handler (Screen 3) ──
    function escWeb(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    window.addEventListener('message', ev => {
        const msg = ev.data;
        if (msg.command === 'metaLoaded') {
            const inner = document.getElementById('inner-' + msg.name);
            if (!inner) return;

            const meta = msg.meta || {};
            const ports = msg.ports || [];
            const spec = escWeb(meta.machineDisplayName || meta.machineName || '2 vCPU, 8 GB RAM');
            const loc = meta.location ? ' (' + escWeb(meta.location) + ')' : '';
            const timeAgo = escWeb(meta.lastUsedAt ? formatTime(meta.lastUsedAt) : 'N/A');
            const safeName = escWeb(msg.name);
            const safeAcc = escWeb(meta.account || '');

            let portsHtml = '';
            if (ports.length > 0) {
                portsHtml = '<div class="ports-container"><div class="ports-heading">Forwarded Ports:</div>' +
                    ports.map(p => {
                        const isOpen = p.browseUrl && p.browseUrl.length > 0;
                        const safeUrl = escWeb(p.browseUrl || '');
                        const safePort = escWeb(String(p.sourcePort == null ? '' : p.sourcePort));
                        const safeVis = escWeb(p.visibility || 'private');
                        return '<div class="port-item-row" data-url="' + safeUrl + '">' +
                            '<div class="port-info-left">' +
                                '<span class="port-dot ' + (isOpen ? 'port-online' : 'port-offline') + '"></span>' +
                                '<span class="port-title">Port ' + safePort + ' <span class="port-vis">(' + safeVis + ')</span></span>' +
                            '</div>' +
                            '<span class="port-ext-ico">' + '${I.linkExternal}' + '</span>' +
                        '</div>';
                    }).join('') +
                '</div>';
            }

            inner.innerHTML = \`
                <div class="meta-row">\${'${I.desktop}'} <span class="meta-label">Machine:</span> <span class="meta-val">\${spec}\${loc}</span></div>
                <div class="meta-row">\${'${I.clock}'} <span class="meta-label">Last Active:</span> <span class="meta-val">\${timeAgo}</span></div>
                \${portsHtml}
                <div class="detail-actions-grid">
                    <button class="grid-btn" data-act="testSSH" data-cs="\${safeName}" data-acc="\${safeAcc}">
                        \${'${I.zap}'} <span>Test SSH</span>
                    </button>
                    <button class="grid-btn" data-act="rebuild" data-cs="\${safeName}" data-acc="\${safeAcc}">
                        \${'${I.wrench}'} <span>Rebuild</span>
                    </button>
                    <button class="grid-btn" data-act="copySSH" data-cs="\${safeName}">
                        \${'${I.term}'} <span>Copy SSH</span>
                    </button>
                    <button class="grid-btn btn-danger" data-act="delete" data-cs="\${safeName}" data-acc="\${safeAcc}">
                        \${'${I.trash}'} <span>Delete</span>
                    </button>
                </div>
            \`;

            // Wire forwarded port links
            inner.querySelectorAll('.port-item-row').forEach(row => {
                row.addEventListener('click', () => {
                    const url = row.dataset.url;
                    if (url) vscode.postMessage({ command: 'openPortUrl', url });
                });
            });

            // Wire 2x2 action buttons
            inner.querySelectorAll('.grid-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const act = btn.dataset.act;
                    const name = btn.dataset.cs;
                    const account = btn.dataset.acc;

                    if (act === 'rebuild') {
                        openRebuildModal(name, account);
                        return;
                    }
                    if (act === 'delete') {
                        openDeleteModal(name, account);
                        return;
                    }
                    vscode.postMessage({ command: act, name, account });
                });
            });
        } else if (msg.command === 'metaError') {
            const inner = document.getElementById('inner-' + msg.name);
            if (inner) {
                inner.innerHTML = '<div class="meta-row"><span class="meta-label">Details unavailable:</span> <span class="meta-val">' + escWeb(msg.error || 'could not load') + '</span></div>';
            }
        }
    });

    function formatTime(dateStr) {
        if (!dateStr) return 'N/A';
        try {
            const time = new Date(dateStr).getTime();
            if (!Number.isFinite(time)) return 'N/A';
            const diffMs = Date.now() - time;
            const m = Math.floor(diffMs / 60000);
            const h = Math.floor(m / 60);
            const d = Math.floor(h / 24);
            if (m < 1) return 'just now';
            if (m < 60) return m + 'm ago';
            if (h < 24) return h + 'h ago';
            return d + 'd ago';
        } catch {
            return dateStr;
        }
    }
    </script>
</body>
</html>`;
    }
}

module.exports = { SidebarProvider };
