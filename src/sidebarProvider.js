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
                        codespaceData: { name: msg.name, account: msg.account }
                    });
                    break;
                case 'copySSH':
                    await vscode.commands.executeCommand('antigravity-codespaces.copySSHCommand', {
                        codespaceData: { name: msg.name }
                    });
                    break;
                case 'delete':
                    await vscode.commands.executeCommand('antigravity-codespaces.deleteCodespace', {
                        codespaceData: { name: msg.name, account: msg.account }
                    });
                    setTimeout(() => this.refresh(), 1500);
                    break;
                case 'switchAccount':
                    await vscode.commands.executeCommand('antigravity-codespaces.switchAccount');
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
                    if (msg.url) vscode.env.openExternal(vscode.Uri.parse(msg.url));
                    break;
                case 'openPortUrl':
                    if (msg.url) vscode.env.openExternal(vscode.Uri.parse(msg.url));
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
                    const meta = await this._githubApi.fetchMeta(msg.name, msg.account);
                    const ports = await this._githubApi.fetchPorts(msg.name, msg.account);
                    this._view?.webview.postMessage({ command: 'metaLoaded', name: msg.name, meta, ports });
                    break;
                }
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
            const codespaces = await this._githubApi.listCodespaces(activeAccount);
            this._view.webview.html = this.buildSidebarHtml(accounts, activeAccount, codespaces);
        } catch (err) {
            this._view.webview.html = `
            <div style="padding:16px;color:var(--vscode-errorForeground);">
                <p>Failed to load Codespaces: ${escapeHtml(err.message)}</p>
                <button style="margin-top:8px;" onclick="vscSimple('refresh')">Retry</button>
            </div>`;
        }
    }

    buildWelcomeHtml(diag) {
        const nonce = generateNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 12px);
    color: var(--vscode-foreground);
    background: transparent;
    padding: 14px;
}
.welcome-card {
    background: var(--vscode-sideBarSectionHeader-background, rgba(255,255,255,0.04));
    border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,0.08));
    border-radius: 8px;
    padding: 14px;
    margin-bottom: 14px;
    text-align: center;
}
.hero-icon {
    display: inline-flex;
    padding: 10px;
    background: rgba(56, 139, 253, 0.12);
    border-radius: 50%;
    color: #388bfd;
    margin-bottom: 10px;
}
.welcome-title {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 6px;
}
.welcome-desc {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.4;
    margin-bottom: 14px;
}
.quota-pill {
    display: inline-block;
    background: rgba(46, 160, 67, 0.15);
    color: #2ea043;
    border: 1px solid rgba(46, 160, 67, 0.3);
    border-radius: 12px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 600;
    margin-bottom: 12px;
}
.btn-primary {
    width: 100%;
    padding: 8px 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-weight: 600;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
}
.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
.btn-secondary {
    width: 100%;
    padding: 6px 12px;
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-button-secondaryBorder, rgba(255,255,255,0.15));
    border-radius: 5px;
    cursor: pointer;
    font-size: 11px;
    margin-bottom: 10px;
}
.btn-secondary:hover { background: rgba(255,255,255,0.06); }
.signup-link {
    font-size: 11px;
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
    cursor: pointer;
    display: inline-block;
}
.signup-link:hover { text-decoration: underline; }
.diag-box {
    margin-top: 14px;
    background: rgba(0,0,0,0.15);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 10px;
    text-align: left;
}
.diag-title {
    font-weight: 600;
    margin-bottom: 6px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.diag-row {
    display: flex;
    justify-content: space-between;
    padding: 2px 0;
    color: var(--vscode-descriptionForeground);
}
.diag-val { font-weight: 600; }
.val-ok { color: #2ea043; }
.val-warn { color: #f59e0b; }
</style>
</head>
<body>
    <div class="welcome-card">
        <div class="hero-icon">${I.cloud}</div>
        <h2 class="welcome-title">Antigravity Codespaces</h2>
        <div class="quota-pill">60 free compute hrs / month</div>
        <p class="welcome-desc">
            Connect, launch, and manage full cloud developer containers directly inside Antigravity IDE.
        </p>

        <button class="btn-primary" id="loginBtn">
            ${I.user} <span>Sign In with GitHub</span>
        </button>
        <button class="btn-secondary" id="patBtn">
            ${I.shield} <span>Use Personal Access Token (PAT)</span>
        </button>
        <div>
            <a class="signup-link" id="signupLink">Don't have an account? Create one free &rarr;</a>
        </div>
    </div>

    <div class="diag-box">
        <div class="diag-title">System Health Checklist</div>
        <div class="diag-row">
            <span>GitHub CLI (SSH Tunnels):</span>
            <span class="diag-val ${diag.ghInstalled ? 'val-ok' : 'val-warn'}">${diag.ghInstalled ? 'Installed' : 'Missing'}</span>
        </div>
        <div class="diag-row">
            <span>OpenSSH Client:</span>
            <span class="diag-val ${diag.hasOpenSsh ? 'val-ok' : 'val-warn'}">${diag.hasOpenSsh ? 'Available' : 'Missing'}</span>
        </div>
        <div class="diag-row">
            <span>Remote SSH Extension:</span>
            <span class="diag-val ${diag.hasRemoteSsh ? 'val-ok' : 'val-warn'}">${diag.hasRemoteSsh ? 'Detected' : 'Recommended'}</span>
        </div>
        ${!diag.ghInstalled ? `<div style="margin-top:6px;"><a class="signup-link" id="installGhLink">Install GitHub CLI &rarr;</a></div>` : ''}
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

    buildSidebarHtml(accounts, activeAccount, codespaces) {
        const nonce = generateNonce();

        const csListHtml = codespaces.map(cs => {
            const isRunning = cs.state === 'Available';
            const branch = cs.gitStatus?.ref || '—';
            const repoShort = (cs.repository || cs.name).split('/').pop() || cs.name;
            const name = cs.displayName || cs.name;

            return `
            <div class="cs-card ${isRunning ? 'is-running' : 'is-stopped'}" id="card-${escapeHtml(cs.name)}" data-name="${escapeHtml(cs.name.toLowerCase())}" data-repo="${escapeHtml((cs.repository || '').toLowerCase())}">
                <div class="cs-top-row">
                    <div class="cs-title-wrap" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account || activeAccount)}">
                        <span class="status-dot"></span>
                        <span class="cs-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                    </div>
                    <div class="cs-actions-right">
                        <button class="act-btn btn-connect" data-act="connect" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(activeAccount)}" data-repo="${escapeHtml(cs.repository)}" title="Connect in Antigravity IDE">
                            ${I.play}
                        </button>
                        ${isRunning
                            ? `<button class="act-btn btn-stop" data-act="stop" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(activeAccount)}" title="Stop Codespace (save hours)">${I.stop}</button>`
                            : `<button class="act-btn btn-start" data-act="start" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(activeAccount)}" title="Turn ON Codespace">${I.power}</button>`
                        }
                        <button class="act-btn btn-globe" data-act="openWeb" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(activeAccount)}" title="Open in GitHub Web">
                            ${I.globe}
                        </button>
                    </div>
                </div>

                <div class="cs-sub-row" data-cs="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account || activeAccount)}">
                    <span class="cs-repo" title="${escapeHtml(cs.repository)}">${I.repo} ${escapeHtml(repoShort)}</span>
                    <span class="cs-branch" title="Branch: ${escapeHtml(branch)}">${I.branch} ${escapeHtml(branch)}</span>
                </div>

                <div class="cs-details" id="details-${escapeHtml(cs.name)}">
                    <div class="details-inner" id="inner-${escapeHtml(cs.name)}">
                        <div class="loading-meta">Loading machine specs & ports...</div>
                    </div>
                </div>
            </div>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 12px);
    color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
    background: transparent;
    padding: 8px;
    user-select: none;
    -webkit-user-select: none;
}
.top-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--vscode-sideBarSectionHeader-background, rgba(255,255,255,0.05));
    border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,0.08));
    border-radius: 6px;
    padding: 6px 8px;
    margin-bottom: 8px;
}
.acct-info {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.acct-info svg { color: var(--vscode-charts-blue, #388bfd); flex-shrink: 0; }
.acct-name { overflow: hidden; text-overflow: ellipsis; }
.acct-switch-btn {
    background: transparent;
    border: 1px solid var(--vscode-button-secondaryBorder, rgba(255,255,255,0.15));
    color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
}
.acct-switch-btn:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.1));
}
.search-bar-wrap {
    position: relative;
    margin-bottom: 10px;
}
.search-input {
    width: 100%;
    background: var(--vscode-input-background, rgba(0,0,0,0.2));
    color: var(--vscode-input-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
    border-radius: 4px;
    padding: 5px 8px 5px 26px;
    font-size: 12px;
    outline: none;
}
.search-input:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
}
.search-ico {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--vscode-input-placeholderForeground, rgba(255,255,255,0.4));
    pointer-events: none;
    display: flex;
}
.cs-card {
    background: var(--vscode-list-inactiveSelectionBackground, rgba(255,255,255,0.03));
    border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,0.06));
    border-radius: 6px;
    margin-bottom: 6px;
    padding: 7px 8px;
    transition: border-color 0.15s, background 0.15s;
}
.cs-card:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06));
    border-color: var(--vscode-list-activeSelectionBackground, rgba(255,255,255,0.15));
}
.cs-card.is-running {
    border-left: 3px solid var(--vscode-testing-iconPassed, #238636);
}
.cs-card.is-stopped {
    border-left: 3px solid var(--vscode-descriptionForeground, #6e7681);
}
.cs-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
}
.cs-title-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
}
.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}
.is-running .status-dot {
    background: var(--vscode-testing-iconPassed, #2ea043);
    box-shadow: 0 0 6px rgba(46,160,67,0.5);
}
.is-stopped .status-dot {
    background: var(--vscode-descriptionForeground, #6e7681);
}
.cs-name {
    font-weight: 600;
    color: var(--vscode-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.cs-actions-right {
    display: flex !important;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
}
.act-btn {
    border: none;
    outline: none;
    border-radius: 4px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    transition: transform 0.1s, background 0.15s;
}
.act-btn:hover { transform: scale(1.1); }
.btn-connect {
    background: var(--vscode-button-background, #007fd4);
    color: var(--vscode-button-foreground, #ffffff);
}
.btn-connect:hover { background: var(--vscode-button-hoverBackground, #026ec1); }
.btn-start {
    background: var(--vscode-testing-iconPassed, #238636);
    color: #ffffff;
}
.btn-start:hover { background: #2ea043; }
.btn-stop {
    background: var(--vscode-testing-iconFailed, #da3633);
    color: #ffffff;
}
.btn-stop:hover { background: #f85149; }
.btn-globe {
    background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08));
    color: var(--vscode-foreground);
    border: 1px solid rgba(255,255,255,0.1);
}
.btn-globe:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.15)); }
.cs-sub-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 3px;
    padding-left: 14px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #8b949e);
    cursor: pointer;
}
.cs-repo, .cs-branch {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.cs-branch {
    background: var(--vscode-badge-background, rgba(255,255,255,0.08));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
}
.cs-details {
    display: none;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,0.08));
    font-size: 11px;
}
.cs-details.open { display: block; }
.details-inner {
    display: flex;
    flex-direction: column;
    gap: 5px;
}
.meta-line {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--vscode-descriptionForeground, #8b949e);
}
.meta-line svg { flex-shrink: 0; color: var(--vscode-charts-blue, #58a6ff); }
.meta-val { color: var(--vscode-foreground); }
.ports-section {
    margin-top: 4px;
    padding: 4px 6px;
    background: rgba(0,0,0,0.15);
    border-radius: 4px;
}
.port-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--vscode-textLink-foreground, #58a6ff);
    cursor: pointer;
    padding: 2px 0;
}
.port-item:hover { text-decoration: underline; }
.detail-actions {
    display: flex;
    gap: 5px;
    margin-top: 6px;
    flex-wrap: wrap;
}
.small-btn {
    background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-button-secondaryBorder, rgba(255,255,255,0.1));
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
.small-btn:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.15)); }
.small-btn.btn-danger { color: var(--vscode-errorForeground, #f85149); }
.small-btn.btn-danger:hover { background: rgba(248,81,73,0.15); }
.loading-meta {
    color: var(--vscode-descriptionForeground, #8b949e);
    font-style: italic;
}
</style>
</head>
<body>

<div class="top-banner">
    <div class="acct-info" title="Current Active GitHub Account">
        ${I.user}
        <span class="acct-name">${escapeHtml(activeAccount)}</span>
    </div>
    <button class="acct-switch-btn" id="switchAccBtn" title="Switch Account">Switch</button>
</div>

<div class="search-bar-wrap">
    <span class="search-ico">${I.search}</span>
    <input class="search-input" id="searchBox" type="text" placeholder="Search Codespaces...">
</div>

<div id="csList">
    ${codespaces.length ? csListHtml : '<div style="text-align:center;padding:16px;color:var(--vscode-descriptionForeground);">No Codespaces found.</div>'}
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

document.getElementById('switchAccBtn').addEventListener('click', () => {
    vscode.postMessage({ command: 'switchAccount' });
});

const searchBox = document.getElementById('searchBox');
searchBox.addEventListener('input', () => {
    const q = (searchBox.value || '').toLowerCase();
    document.querySelectorAll('.cs-card').forEach(c => {
        const name = c.getAttribute('data-name') || '';
        const repo = c.getAttribute('data-repo') || '';
        const match = !q || name.includes(q) || repo.includes(q);
        c.style.display = match ? '' : 'none';
    });
});

document.addEventListener('click', (ev) => {
    const actBtn = ev.target.closest('.act-btn');
    if (actBtn) {
        ev.stopPropagation();
        const cmd = actBtn.dataset.act;
        const name = actBtn.dataset.cs;
        const account = actBtn.dataset.acc;
        const repo = actBtn.dataset.repo;
        vscode.postMessage({ command: cmd, name, account, repo });
        return;
    }

    const titleWrap = ev.target.closest('.cs-title-wrap, .cs-sub-row');
    if (titleWrap) {
        const name = titleWrap.dataset.cs;
        const account = titleWrap.dataset.acc;
        toggleDetails(name, account);
    }
});

const loadedMeta = new Set();
function toggleDetails(name, account) {
    const d = document.getElementById('details-' + name);
    if (!d) return;
    const isOpen = d.classList.contains('open');
    if (isOpen) {
        d.classList.remove('open');
    } else {
        d.classList.add('open');
        if (!loadedMeta.has(name)) {
            loadedMeta.add(name);
            vscode.postMessage({ command: 'fetchMeta', name, account });
        }
    }
}

window.addEventListener('message', ev => {
    const msg = ev.data;
    if (msg.command === 'metaLoaded') {
        const inner = document.getElementById('inner-' + msg.name);
        if (!inner) return;
        const meta = msg.meta || {};
        const ports = msg.ports || [];
        const spec = meta.machineDisplayName || meta.machineName || '2 vCPU, 8 GB RAM';
        const loc = meta.location ? ' (' + meta.location + ')' : '';
        const timeAgo = meta.lastUsedAt ? meta.lastUsedAt : 'N/A';

        let portsHtml = '';
        if (ports.length) {
            portsHtml = '<div class="ports-section"><div style="font-weight:600;margin-bottom:2px;">Forwarded Ports:</div>' +
                ports.map(p => '<div class="port-item" data-url="' + (p.browseUrl || '') + '"><span>Port ' + p.sourcePort + ' (' + (p.visibility||'private') + ')</span><span>' + '${I.link}' + '</span></div>').join('') +
                '</div>';
        }

        inner.innerHTML = \`
            <div class="meta-line">\${'${I.server}'} <span>Machine:</span> <span class="meta-val">\${spec}\${loc}</span></div>
            <div class="meta-line">\${'${I.clock}'} <span>Last Active:</span> <span class="meta-val">\${timeAgo}</span></div>
            \${portsHtml}
            <div class="detail-actions">
                <button class="small-btn" data-act="testSSH" data-cs="\${msg.name}" data-acc="\${meta.account||''}"><span style="display:flex;">\${'${I.zap}'}</span> Test SSH</button>
                <button class="small-btn" data-act="rebuild" data-cs="\${msg.name}" data-acc="\${meta.account||''}"><span style="display:flex;">\${'${I.build}'}</span> Rebuild</button>
                <button class="small-btn" data-act="copySSH" data-cs="\${msg.name}"><span style="display:flex;">\${'${I.term}'}</span> Copy SSH</button>
                <button class="small-btn btn-danger" data-act="delete" data-cs="\${msg.name}"><span style="display:flex;">\${'${I.trash}'}</span> Delete</button>
            </div>
        \`;

        inner.querySelectorAll('.port-item').forEach(el => {
            el.addEventListener('click', () => {
                const url = el.dataset.url;
                if (url) vscode.postMessage({ command: 'openPortUrl', url });
            });
        });

        inner.querySelectorAll('.detail-actions button').forEach(btn => {
            btn.addEventListener('click', () => {
                const cmd = btn.dataset.act;
                const name = btn.dataset.cs;
                const account = btn.dataset.acc;
                vscode.postMessage({ command: cmd, name, account });
            });
        });
    }
});
</script>
</body>
</html>`;
    }
}

module.exports = { SidebarProvider };
