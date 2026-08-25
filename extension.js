const vscode = require('vscode');
const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const GH_PATH = 'gh';
const SSH_CONFIG_PATH = path.join(os.homedir(), '.ssh', 'config');
const SSH_DIR = path.join(os.homedir(), '.ssh');

function getGhExecutablePath() {
    const candidates = [
        'C:\\Program Files\\GitHub CLI\\gh.exe',
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'GitHub CLI', 'gh.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe'),
        path.join(os.homedir(), 'scoop', 'shims', 'gh.exe')
    ];
    for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
    }
    return 'gh.exe';
}

function getAntigravityExePath() {
    const candidates = [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
        'C:\\Users\\lenovo\\AppData\\Local\\Programs\\Antigravity IDE\\bin\\antigravity-ide.cmd'
    ];
    for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
    }
    return 'antigravity-ide.cmd';
}

let isConnecting = false;
const tokenCache = new Map();

async function getAccountToken(account) {
    if (!account) return null;
    if (tokenCache.has(account)) return tokenCache.get(account);
    try {
        const token = await runCommand(GH_PATH, ['auth', 'token', '-u', account], 6000);
        if (token && !token.includes('error')) {
            tokenCache.set(account, token);
            return token;
        }
    } catch {}
    return null;
}

// ─── Robust Command Runner ───────────────────────────────────────────────────
function runCommand(cmd, args = [], timeoutMs = 15000, options = {}) {
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            done = true;
            reject(new Error(`Timed out (${timeoutMs / 1000}s): ${cmd} ${args.join(' ')}`));
        }, timeoutMs);

        const spawnOpts = { windowsHide: true, ...options };
        execFile(cmd, args, spawnOpts, (err, stdout, stderr) => {
            if (done) return;
            clearTimeout(timer);
            if (!err) return resolve((stdout || '').trim());

            // Fallback: shell execution (handles PATH quirks on Windows)
            const cmdStr = `"${cmd}" ${args.map(a => `"${a}"`).join(' ')}`;
            exec(cmdStr, { ...spawnOpts, timeout: timeoutMs }, (err2, stdout2) => {
                if (err2) return reject(new Error(stderr || err2.message));
                resolve((stdout2 || '').trim());
            });
        });
    });
}

function formatRelativeTime(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const diffMs = Date.now() - new Date(dateStr).getTime();
        const m = Math.floor(diffMs / 60000);
        const h = Math.floor(m / 60);
        const d = Math.floor(h / 24);
        if (m < 1) return 'just now';
        if (m < 60) return `${m}m ago`;
        if (h < 24) return `${h}h ago`;
        return `${d}d ago`;
    } catch { return dateStr; }
}

function ensureSSHConfigEntry(cs, account) {
    try {
        if (!fs.existsSync(SSH_DIR)) fs.mkdirSync(SSH_DIR, { recursive: true });
        const acc = account || cs.account || 'Nir-Bhay';
        const repoShort = (cs.repository || cs.name).split('/').pop();
        const aliasLower = `cs-${acc}-${repoShort}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const aliasExact = `cs-${acc}-${repoShort}`.replace(/[^a-zA-Z0-9-]/g, '-');
        const exactHost = `cs.${cs.name}`;
        const rawName = cs.name;

        let cfg = fs.existsSync(SSH_CONFIG_PATH) ? fs.readFileSync(SSH_CONFIG_PATH, 'utf8') : '';
        const key = path.join(SSH_DIR, 'codespaces.auto');

        const blockId = `# CS_ENTRY:${cs.name}`;
        const ghExe = getGhExecutablePath();

        let aliveInterval = 30;
        let aliveMax = 10;
        try {
            const config = vscode.workspace.getConfiguration('antigravity-codespaces');
            aliveInterval = config.get('serverAliveInterval', 30);
            aliveMax = config.get('serverAliveCountMax', 10);
        } catch {}

        const newBlock = `\n${blockId}\nHost ${exactHost} ${aliasLower} ${aliasExact} ${rawName}\n  User codespace\n  ProxyCommand "${ghExe}" cs ssh -c ${cs.name} --stdio -- -i "${key}"\n  UserKnownHostsFile /dev/null\n  StrictHostKeyChecking no\n  LogLevel quiet\n  ServerAliveInterval ${aliveInterval}\n  ServerAliveCountMax ${aliveMax}\n  TCPKeepAlive yes\n  IdentityFile "${key}"\n`;

        if (cfg.includes(blockId)) {
            const regex = new RegExp(`\\n*${blockId}[\\s\\S]*?IdentityFile[^\\n]*`, 'g');
            cfg = cfg.replace(regex, '');
        }

        cfg = cfg.trim() + '\n\n' + newBlock.trim() + '\n';
        fs.writeFileSync(SSH_CONFIG_PATH, cfg, 'utf8');

        return exactHost;
    } catch (e) {
        console.error('SSH config error:', e);
        return `cs.${cs.name}`;
    }
}

// ─── SVG Icon Set ─────────────────────────────────────────────────────────────
const I = {
    cloud: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
    play:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    stop:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
    power: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`,
    globe: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    build: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    term:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
    trash: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    repo:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    branch:`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
    clock: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    server:`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
    plus:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    sync:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>`,
    refresh:`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>`,
    user:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    search:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    plug:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v6m-6 4h12m-6 4v6m-4-6h8"/></svg>`,
    link:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    zap:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    chevron:`<svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>`
};

// ─── Sidebar Webview Provider ─────────────────────────────────────────────────
class CodespacesSidebarProvider {
    constructor(extensionUri) {
        this._extensionUri = extensionUri;
        this.activeAccount = '';
        this.allAccounts = [];
        this.showAllAccounts = false;
        this.csCache = new Map();
        this.metaCache = new Map();
        this.portsCache = new Map();
        this.loading = false;
    }

    resolveWebviewView(webviewView, context, _token) {
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
                    setTimeout(() => this.refresh(), 2500);
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
                    await vscode.commands.executeCommand('antigravity-codespaces.loginGitHub');
                    break;
                case 'openPortUrl':
                    await vscode.commands.executeCommand('antigravity-codespaces.openPortUrl', msg.url);
                    break;
                case 'testSSH':
                    await vscode.commands.executeCommand('antigravity-codespaces.testSSH', {
                        codespaceData: { name: msg.name, account: msg.account }
                    });
                    break;
                case 'syncAllSSH':
                    await vscode.commands.executeCommand('antigravity-codespaces.syncAllSSH');
                    break;
                case 'fetchMeta':
                    const meta = await this.fetchMeta(msg.name, msg.account);
                    const ports = await this.fetchPorts(msg.name, msg.account);
                    this._view && this._view.webview.postMessage({ command: 'metaLoaded', name: msg.name, meta, ports });
                    break;
            }
        });

        this.render();
    }

    async refresh() {
        this.csCache.clear();
        this.metaCache.clear();
        this.portsCache.clear();
        await this.render();
    }

    async getAccounts() {
        try {
            const raw = await runCommand(GH_PATH, ['auth', 'status'], 6000);
            const accts = [];
            const re = /Logged in to github\.com account ([A-Za-z0-9_\-]+)/g;
            let m;
            while ((m = re.exec(raw)) !== null) {
                if (!accts.includes(m[1])) accts.push(m[1]);
            }
            const activeMatch = raw.match(/account ([A-Za-z0-9_\-]+)[^\n]*\n[^\n]*Active account:\s*true/);
            if (activeMatch && !this.activeAccount) this.activeAccount = activeMatch[1];
            else if (accts.length && !this.activeAccount) this.activeAccount = accts[0];
            this.allAccounts = accts;
            return accts;
        } catch {
            return [];
        }
    }

    async fetchCodespaces(account) {
        if (this.csCache.has(account)) return this.csCache.get(account);
        try {
            const token = await getAccountToken(account);
            const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
            const raw = await runCommand(GH_PATH, [
                'codespace', 'list',
                '--json', 'name,displayName,repository,gitStatus,state,lastUsedAt,machineName'
            ], 12000, envOpts);
            const list = JSON.parse(raw || '[]');
            list.sort((a, b) => {
                if (a.state === 'Available' && b.state !== 'Available') return -1;
                if (b.state === 'Available' && a.state !== 'Available') return 1;
                return new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0);
            });
            this.csCache.set(account, list);
            return list;
        } catch (e) {
            console.error(`fetchCodespaces(${account}):`, e.message);
            return [];
        }
    }

    async fetchPorts(name, account) {
        const cacheKey = `${account || ''}:${name}`;
        if (this.portsCache.has(cacheKey)) return this.portsCache.get(cacheKey);
        try {
            const token = await getAccountToken(account);
            const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
            const raw = await runCommand(GH_PATH, ['codespace', 'ports', '-c', name, '--json', 'sourcePort,label,visibility,browseUrl'], 6000, envOpts);
            const p = JSON.parse(raw || '[]');
            this.portsCache.set(cacheKey, p);
            return p;
        } catch { return []; }
    }

    async fetchMeta(name, account) {
        const cacheKey = `${account || ''}:${name}`;
        if (this.metaCache.has(cacheKey)) return this.metaCache.get(cacheKey);
        try {
            const token = await getAccountToken(account);
            const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
            const raw = await runCommand(GH_PATH, [
                'codespace', 'view', '-c', name,
                '--json', 'displayName,name,repository,state,gitStatus,machineDisplayName,machineName,createdAt,lastUsedAt,idleTimeoutMinutes,retentionPeriodDays,location'
            ], 8000, envOpts);
            const m = JSON.parse(raw || '{}');
            this.metaCache.set(cacheKey, m);
            return m;
        } catch { return {}; }
    }

    async render() {
        if (!this._view) return;
        try {
            const accounts = await this.getAccounts();
            if (accounts.length === 0) {
                this._view.webview.html = this.buildNoAuthHtml();
                return;
            }
            const codespaces = await this.fetchCodespaces(this.activeAccount);
            this._view.webview.html = this.buildSidebarHtml(accounts, this.activeAccount, codespaces);
        } catch (err) {
            this._view.webview.html = `<div style="padding:16px;color:var(--vscode-errorForeground);">
                <p>Error: ${err.message}</p>
                <button onclick="acquireVsCodeApi().postMessage({command:'refresh'})">Retry</button>
            </div>`;
        }
    }

    buildNoAuthHtml() {
        return `<!DOCTYPE html>
        <html>
        <head>
        <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; background: transparent; }
        .login-btn { width: 100%; padding: 8px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; font-weight: 600; }
        .login-btn:hover { background: var(--vscode-button-hoverBackground); }
        </style>
        </head>
        <body>
            <div style="text-align:center; padding: 20px 0;">
                <p style="margin-bottom: 12px; opacity: 0.8;">No GitHub accounts authenticated.</p>
                <button class="login-btn" onclick="acquireVsCodeApi().postMessage({command:'loginGitHub'})">Login to GitHub</button>
            </div>
        </body>
        </html>`;
    }

    buildSidebarHtml(accounts, activeAccount, codespaces) {
        const csListHtml = codespaces.map(cs => {
            const isRunning = cs.state === 'Available';
            const branch = cs.gitStatus?.ref || 'main';
            const repoShort = (cs.repository || '').split('/').pop() || cs.name;
            const name = cs.displayName || cs.name;
            const timeAgo = formatRelativeTime(cs.lastUsedAt);

            return `
            <div class="cs-card ${isRunning ? 'is-running' : 'is-stopped'}" id="card-${cs.name}" data-name="${cs.name.toLowerCase()}" data-repo="${(cs.repository || '').toLowerCase()}">
                <!-- Top Row: Status Dot + Name + RIGHT ACTION ICONS ALWAYS VISIBLE -->
                <div class="cs-top-row">
                    <div class="cs-title-wrap" onclick="toggleDetails('${cs.name}', '${cs.account || activeAccount}')">
                        <span class="status-dot"></span>
                        <span class="cs-name" title="${name}">${name}</span>
                    </div>
                    <!-- Right Actions ALWAYS VISIBLE (No hover needed) -->
                    <div class="cs-actions-right">
                        <button class="act-btn btn-connect" onclick="vsc('connect','${cs.name}','${activeAccount}','${cs.repository}')" title="Connect in Antigravity IDE">
                            ${I.play}
                        </button>
                        ${isRunning
                            ? `<button class="act-btn btn-stop" onclick="vsc('stop','${cs.name}','${activeAccount}')" title="Stop Codespace (save billing)">${I.stop}</button>`
                            : `<button class="act-btn btn-start" onclick="vsc('start','${cs.name}','${activeAccount}')" title="Turn ON Codespace">${I.power}</button>`
                        }
                        <button class="act-btn btn-globe" onclick="vsc('openWeb','${cs.name}','${activeAccount}')" title="Open in GitHub Web">
                            ${I.globe}
                        </button>
                    </div>
                </div>

                <!-- Sub Row: Repository + Branch -->
                <div class="cs-sub-row" onclick="toggleDetails('${cs.name}', '${cs.account || activeAccount}')">
                    <span class="cs-repo" title="${cs.repository}">${I.repo} ${repoShort}</span>
                    <span class="cs-branch" title="Branch: ${branch}">${I.branch} ${branch}</span>
                </div>

                <!-- Expandable Details Section -->
                <div class="cs-details" id="details-${cs.name}">
                    <div class="details-inner" id="inner-${cs.name}">
                        <div class="loading-meta">Loading machine specs & ports...</div>
                    </div>
                </div>
            </div>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
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

/* ── Top Header / Account Banner ── */
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

/* ── Search Bar ── */
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

/* ── Codespace Card ── */
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

/* ── Card Top Row ── */
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
.is-running .status-dot { background: var(--vscode-testing-iconPassed, #2ea043); box-shadow: 0 0 6px rgba(46,160,67,0.5); }
.is-stopped .status-dot { background: var(--vscode-descriptionForeground, #6e7681); }
.cs-name {
    font-weight: 600;
    color: var(--vscode-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ── RIGHT ACTION ICONS: PERMANENTLY VISIBLE WITHOUT HOVER ── */
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
.act-btn:hover {
    transform: scale(1.1);
}
.btn-connect {
    background: var(--vscode-button-background, #007fd4);
    color: var(--vscode-button-foreground, #ffffff);
}
.btn-connect:hover {
    background: var(--vscode-button-hoverBackground, #026ec1);
}
.btn-start {
    background: var(--vscode-testing-iconPassed, #238636);
    color: #ffffff;
}
.btn-start:hover {
    background: #2ea043;
}
.btn-stop {
    background: var(--vscode-testing-iconFailed, #da3633);
    color: #ffffff;
}
.btn-stop:hover {
    background: #f85149;
}
.btn-globe {
    background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08));
    color: var(--vscode-foreground);
    border: 1px solid rgba(255,255,255,0.1);
}
.btn-globe:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.15));
}

/* ── Card Sub Row (Repo + Branch) ── */
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

/* ── Expandable Details Accordion ── */
.cs-details {
    display: none;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--vscode-sideBarSectionHeader-border, rgba(255,255,255,0.08));
    font-size: 11px;
}
.cs-details.open {
    display: block;
}
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
.small-btn:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.15));
}
.small-btn.btn-danger {
    color: var(--vscode-errorForeground, #f85149);
}
.small-btn.btn-danger:hover {
    background: rgba(248,81,73,0.15);
}
.loading-meta {
    color: var(--vscode-descriptionForeground, #8b949e);
    font-style: italic;
    font-size: 11px;
}
</style>
</head>
<body>

<!-- Top Banner: Active Account -->
<div class="top-banner">
    <div class="acct-info" title="Current Active GitHub Account">
        ${I.user}
        <span class="acct-name">${activeAccount}</span>
    </div>
    <button class="acct-switch-btn" onclick="vscSimple('switchAccount')" title="Switch Account">Switch</button>
</div>

<!-- Search Input -->
<div class="search-bar-wrap">
    <span class="search-ico">${I.search}</span>
    <input class="search-input" id="searchBox" type="text" placeholder="Search Codespaces..." oninput="filterCards()">
</div>

<!-- Codespaces List -->
<div id="csList">
    ${codespaces.length ? csListHtml : '<div style="text-align:center;padding:16px;color:var(--vscode-descriptionForeground);">No Codespaces found.</div>'}
</div>

<script>
const vscode = acquireVsCodeApi();

function vsc(cmd, name, account, repo) {
    vscode.postMessage({ command: cmd, name, account, repo });
}
function vscSimple(cmd) {
    vscode.postMessage({ command: cmd });
}

function filterCards() {
    const q = (document.getElementById('searchBox').value || '').toLowerCase();
    document.querySelectorAll('.cs-card').forEach(c => {
        const name = c.getAttribute('data-name') || '';
        const repo = c.getAttribute('data-repo') || '';
        const match = !q || name.includes(q) || repo.includes(q);
        c.style.display = match ? '' : 'none';
    });
}

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
                ports.map(p => '<div class="port-item" onclick="vscode.postMessage({command:\\'openPortUrl\\',url:\\'' + p.browseUrl + '\\'})"><span>Port ' + p.sourcePort + ' (' + (p.visibility||'private') + ')</span><span>' + '${I.link}' + '</span></div>').join('') +
                '</div>';
        }

        inner.innerHTML = \`
            <div class="meta-line">\${'${I.server}'} <span>Machine:</span> <span class="meta-val">\${spec}\${loc}</span></div>
            <div class="meta-line">\${'${I.clock}'} <span>Last Active:</span> <span class="meta-val">\${timeAgo}</span></div>
            \${portsHtml}
            <div class="detail-actions">
                <button class="small-btn" onclick="vsc('testSSH','\${msg.name}','\${meta.account||''}')">\${'${I.zap}'} Test SSH</button>
                <button class="small-btn" onclick="vsc('rebuild','\${msg.name}','\${meta.account||''}')">\${'${I.build}'} Rebuild</button>
                <button class="small-btn" onclick="vsc('copySSH','\${msg.name}')">\${'${I.term}'} Copy SSH</button>
                <button class="small-btn btn-danger" onclick="vsc('delete','\${msg.name}')">\${'${I.trash}'} Delete</button>
            </div>
        \`;
    }
});
</script>
</body>
</html>`;
    }
}

// ─── Dashboard Webview HTML (Bento Grid + Glassmorphism + Dark/Light Mode) ────
function buildDashboardHtml(accountsData, activeAccount) {
    let total = 0, online = 0, offline = 0;
    const flat = [];
    accountsData.forEach(({ account, codespaces }) => {
        codespaces.forEach(cs => {
            total++;
            if (cs.state === 'Available') online++; else offline++;
            flat.push({ ...cs, account });
        });
    });
    flat.sort((a, b) => {
        if (a.state === 'Available' && b.state !== 'Available') return -1;
        if (b.state === 'Available' && a.state !== 'Available') return 1;
        return new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0);
    });

    const accountChips = accountsData.map(({ account, codespaces }) => `
        <button class="bento-chip" onclick="setFilter('${account}')" data-acc="${account}">
            <span class="chip-avatar">${account.slice(0,2).toUpperCase()}</span>
            <span class="chip-name">${account}</span>
            <span class="chip-count">${codespaces.length}</span>
        </button>`).join('');

    const cards = flat.map(cs => {
        const running = cs.state === 'Available';
        const repo = cs.repository || cs.name;
        const repoShort = repo.split('/').pop();
        const branch = cs.gitStatus?.ref || 'main';
        const time = formatRelativeTime(cs.lastUsedAt);

        return `
<article class="bento-card ${running ? 'is-online' : 'is-offline'}" data-account="${cs.account}" data-name="${cs.name}" data-state="${running ? 'running' : 'stopped'}">
  <!-- Card Header -->
  <div class="bento-card-top">
    <div class="card-title-group">
      <div class="radar-status ${running ? 'radar-online' : 'radar-offline'}">
        <span class="radar-dot"></span>
        ${running ? '<span class="radar-ring"></span>' : ''}
      </div>
      <div class="title-meta">
        <h3 class="codespace-title" title="${cs.displayName || cs.name}">${cs.displayName || cs.name}</h3>
        <span class="account-tag" title="GitHub Account: ${cs.account}">${cs.account}</span>
      </div>
    </div>
    <div class="badge-status ${running ? 'badge-running' : 'badge-stopped'}">
      ${running ? 'RUNNING' : 'STOPPED'}
    </div>
  </div>

  <!-- Bento Meta Rows -->
  <div class="bento-info-box">
    <div class="info-item" title="Repository: ${repo}">
      <span class="info-ico">${I.repo}</span>
      <span class="info-text">${repo}</span>
    </div>
    <div class="info-item" title="Branch: ${branch}">
      <span class="info-ico">${I.branch}</span>
      <code class="info-branch">${branch}</code>
    </div>
    <div class="info-item" title="Last active: ${cs.lastUsedAt || 'N/A'}">
      <span class="info-ico">${I.clock}</span>
      <span class="info-text">Active ${time}</span>
    </div>
  </div>

  <!-- Bento Action Dock -->
  <div class="bento-action-dock">
    <button class="bento-btn btn-primary" onclick="csCmd('connect','${cs.name}','${cs.account}','${repo}')" title="Connect in Antigravity IDE">
      ${I.play} <span>Connect</span>
    </button>
    ${running
        ? `<button class="bento-btn btn-power-stop" onclick="csCmd('stop','${cs.name}','${cs.account}')" title="Stop Codespace (save billing)">${I.stop} <span>Stop</span></button>`
        : `<button class="bento-btn btn-power-start" onclick="csCmd('start','${cs.name}','${cs.account}')" title="Turn ON Codespace">${I.power} <span>Start</span></button>`}
    
    <div class="btn-dock-icons">
      <button class="dock-ico-btn" onclick="csCmd('testSSH','${cs.name}','${cs.account}')" title="Test SSH Tunnel Health">
        ${I.zap}
      </button>
      <button class="dock-ico-btn" onclick="csCmd('openWeb','${cs.name}','${cs.account}')" title="Open in GitHub Web Browser">
        ${I.globe}
      </button>
      <button class="dock-ico-btn" onclick="csCmd('rebuild','${cs.name}','${cs.account}')" title="Rebuild DevContainer">
        ${I.build}
      </button>
      <button class="dock-ico-btn" onclick="csCmd('copySSH','${cs.name}','${cs.account}')" title="Copy SSH Command">
        ${I.term}
      </button>
      <button class="dock-ico-btn btn-danger-ico" onclick="csCmd('delete','${cs.name}','${cs.account}')" title="Delete Codespace">
        ${I.trash}
      </button>
    </div>
  </div>
</article>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codespaces Cloud Hub</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --mono-font: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* ── Dark Theme (Default) ── */
[data-theme="dark"] {
  --bg-main: #090b11;
  --bg-gradient: radial-gradient(circle at 10% 20%, rgba(30, 41, 75, 0.45) 0%, rgba(9, 11, 17, 0.95) 90%);
  --bento-bg: rgba(18, 22, 38, 0.7);
  --bento-card-bg: rgba(22, 27, 46, 0.65);
  --bento-card-hover: rgba(28, 34, 58, 0.85);
  --bento-border: rgba(255, 255, 255, 0.08);
  --bento-border-hover: rgba(56, 139, 253, 0.35);
  --bento-meta-bg: rgba(10, 13, 23, 0.5);
  
  --text-main: #f1f5f9;
  --text-muted: #94a3b8;
  --text-subtle: #64748b;
  
  --accent-primary: #388bfd;
  --accent-primary-hover: #1f6feb;
  --accent-gradient: linear-gradient(135deg, #388bfd, #8b5cf6);
  --accent-gradient-glow: rgba(56, 139, 253, 0.25);
  
  --color-green: #2ea043;
  --color-green-bg: rgba(46, 160, 67, 0.15);
  --color-green-border: rgba(46, 160, 67, 0.3);
  
  --color-red: #f85149;
  --color-red-bg: rgba(248, 81, 73, 0.15);
  --color-red-border: rgba(248, 81, 73, 0.3);

  --account-tag-bg: rgba(139, 92, 246, 0.15);
  --account-tag-color: #c4b5fd;
  
  --input-bg: rgba(13, 16, 28, 0.8);
  --input-border: rgba(255, 255, 255, 0.12);
  --input-focus: #388bfd;

  --shadow-card: 0 4px 20px rgba(0, 0, 0, 0.35);
  --shadow-glow: 0 0 25px rgba(56, 139, 253, 0.15);
}

/* ── Light Theme (Clean Bento White) ── */
[data-theme="light"] {
  --bg-main: #f8fafc;
  --bg-gradient: radial-gradient(circle at 10% 20%, rgba(224, 231, 255, 0.6) 0%, rgba(248, 250, 252, 0.98) 90%);
  --bento-bg: rgba(255, 255, 255, 0.85);
  --bento-card-bg: rgba(255, 255, 255, 0.9);
  --bento-card-hover: #ffffff;
  --bento-border: rgba(0, 0, 0, 0.08);
  --bento-border-hover: rgba(56, 139, 253, 0.5);
  --bento-meta-bg: rgba(241, 245, 249, 0.8);
  
  --text-main: #0f172a;
  --text-muted: #475569;
  --text-subtle: #94a3b8;
  
  --accent-primary: #2563eb;
  --accent-primary-hover: #1d4ed8;
  --accent-gradient: linear-gradient(135deg, #2563eb, #7c3aed);
  --accent-gradient-glow: rgba(37, 99, 235, 0.2);
  
  --color-green: #16a34a;
  --color-green-bg: rgba(22, 163, 74, 0.12);
  --color-green-border: rgba(22, 163, 74, 0.3);
  
  --color-red: #dc2626;
  --color-red-bg: rgba(220, 38, 38, 0.12);
  --color-red-border: rgba(220, 38, 38, 0.3);

  --account-tag-bg: rgba(124, 58, 237, 0.1);
  --account-tag-color: #6d28d9;
  
  --input-bg: #ffffff;
  --input-border: rgba(0, 0, 0, 0.12);
  --input-focus: #2563eb;

  --shadow-card: 0 4px 16px rgba(0, 0, 0, 0.06);
  --shadow-glow: 0 0 20px rgba(37, 99, 235, 0.1);
}

html, body {
  min-height: 100%;
  background: var(--bg-main);
  background-image: var(--bg-gradient);
  background-attachment: fixed;
  color: var(--text-main);
  font-family: var(--font);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
  transition: background 0.25s ease, color 0.25s ease;
}

body {
  padding: 24px 32px 48px;
  max-width: 1400px;
  margin: 0 auto;
}

/* ── Glass Bento Header ── */
.bento-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: var(--bento-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--bento-border);
  border-radius: 16px;
  padding: 16px 20px;
  margin-bottom: 20px;
  box-shadow: var(--shadow-card);
  flex-wrap: wrap;
}

.brand-section {
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand-logo-bento {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--accent-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  box-shadow: var(--shadow-glow);
  flex-shrink: 0;
}

.brand-logo-bento svg {
  width: 24px;
  height: 24px;
}

.brand-titles h1 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-main);
  letter-spacing: -0.3px;
}

.brand-titles p {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}

.brand-author {
  color: var(--accent-primary);
  font-weight: 600;
}

.header-actions-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* ── Buttons ── */
.bento-btn {
  border: 1px solid transparent;
  outline: none;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: var(--font);
}

.bento-btn.btn-primary {
  background: var(--accent-gradient);
  color: #ffffff;
  box-shadow: 0 2px 8px var(--accent-gradient-glow);
}
.bento-btn.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px var(--accent-gradient-glow);
}

.bento-btn.btn-ghost {
  background: var(--bento-meta-bg);
  border-color: var(--bento-border);
  color: var(--text-main);
}
.bento-btn.btn-ghost:hover {
  background: var(--bento-card-hover);
  border-color: var(--bento-border-hover);
}

.btn-power-start {
  background: var(--color-green-bg);
  color: var(--color-green);
  border-color: var(--color-green-border);
}
.btn-power-start:hover {
  background: var(--color-green);
  color: #ffffff;
}

.btn-power-stop {
  background: var(--color-red-bg);
  color: var(--color-red);
  border-color: var(--color-red-border);
}
.btn-power-stop:hover {
  background: var(--color-red);
  color: #ffffff;
}

.theme-toggle-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--bento-meta-bg);
  border: 1px solid var(--bento-border);
  color: var(--text-main);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.theme-toggle-btn:hover {
  background: var(--bento-card-hover);
  border-color: var(--bento-border-hover);
}

/* ── Hero Metric Bento Tiles ── */
.bento-metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 20px;
}
@media (max-width: 768px) {
  .bento-metrics-grid { grid-template-columns: repeat(2, 1fr); }
}

.metric-tile {
  background: var(--bento-card-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--bento-border);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: var(--shadow-card);
  transition: transform 0.15s ease, border-color 0.15s ease;
}
.metric-tile:hover {
  border-color: var(--bento-border-hover);
  transform: translateY(-2px);
}

.metric-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.metric-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  font-weight: 600;
  color: var(--text-subtle);
}
.metric-ico {
  color: var(--accent-primary);
  display: flex;
}
.metric-value {
  font-size: 26px;
  font-weight: 700;
  color: var(--text-main);
  line-height: 1;
}
.metric-value.val-running { color: var(--color-green); }
.metric-value.val-stopped { color: var(--text-muted); }

/* ── Filter & Search Bento Toolbar ── */
.bento-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.account-chips-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bento-bg);
  border: 1px solid var(--bento-border);
  border-radius: 12px;
  padding: 4px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  overflow-x: auto;
  max-width: 100%;
}

.bento-chip {
  background: transparent;
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.bento-chip:hover {
  color: var(--text-main);
  background: rgba(255, 255, 255, 0.05);
}
.bento-chip.active {
  background: var(--bento-card-bg);
  color: var(--text-main);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  border: 1px solid var(--bento-border-hover);
}

.chip-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent-primary);
  color: #ffffff;
  font-size: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}
.chip-count {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 10px;
  background: var(--bento-meta-bg);
  color: var(--text-muted);
  border: 1px solid var(--bento-border);
}

.search-and-status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 260px;
  max-width: 420px;
}

.bento-search-box {
  position: relative;
  flex: 1;
}
.bento-search-box input {
  width: 100%;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--text-main);
  padding: 8px 12px 8px 32px;
  border-radius: 10px;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}
.bento-search-box input:focus {
  border-color: var(--input-focus);
}
.bento-search-ico {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-subtle);
  pointer-events: none;
  display: flex;
}

/* ── Bento Codespaces Grid ── */
.bento-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.bento-card {
  background: var(--bento-card-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--bento-border);
  border-radius: 16px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: var(--shadow-card);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  overflow: hidden;
}
.bento-card:hover {
  background: var(--bento-card-hover);
  border-color: var(--bento-border-hover);
  transform: translateY(-3px);
  box-shadow: var(--shadow-card), var(--shadow-glow);
}

.bento-card.is-online {
  border-top: 3px solid var(--color-green);
}
.bento-card.is-offline {
  border-top: 3px solid var(--bento-border);
}

/* ── Card Top Header ── */
.bento-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.card-title-group {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

/* ── Pulsing Status Radar ── */
.radar-status {
  position: relative;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 2px;
}
.radar-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: block;
  margin: 2px;
}
.radar-online .radar-dot { background: var(--color-green); box-shadow: 0 0 8px rgba(46, 160, 67, 0.6); }
.radar-offline .radar-dot { background: var(--text-subtle); }

.radar-ring {
  position: absolute;
  top: -2px;
  left: -2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--color-green);
  animation: radar-pulse 2s infinite ease-out;
}
@keyframes radar-pulse {
  0% { transform: scale(0.6); opacity: 0.9; }
  70% { transform: scale(1.6); opacity: 0; }
  100% { transform: scale(1.6); opacity: 0; }
}

.title-meta {
  flex: 1;
  min-width: 0;
}
.codespace-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.2px;
}
.account-tag {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 4px;
  background: var(--account-tag-bg);
  color: var(--account-tag-color);
  margin-top: 3px;
}

.badge-status {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 3px 8px;
  border-radius: 6px;
  white-space: nowrap;
}
.badge-running {
  background: var(--color-green-bg);
  color: var(--color-green);
  border: 1px solid var(--color-green-border);
}
.badge-stopped {
  background: var(--bento-meta-bg);
  color: var(--text-subtle);
  border: 1px solid var(--bento-border);
}

/* ── Bento Info Box ── */
.bento-info-box {
  background: var(--bento-meta-bg);
  border: 1px solid var(--bento-border);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.info-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}
.info-ico {
  display: flex;
  color: var(--text-subtle);
  flex-shrink: 0;
}
.info-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.info-branch {
  font-family: var(--mono-font);
  font-size: 11px;
  color: var(--accent-primary);
  background: rgba(56, 139, 253, 0.1);
  padding: 1px 6px;
  border-radius: 4px;
}

/* ── Action Dock ── */
.bento-action-dock {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-dock-icons {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.dock-ico-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--bento-meta-bg);
  border: 1px solid var(--bento-border);
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.dock-ico-btn:hover {
  background: var(--bento-card-hover);
  color: var(--text-main);
  border-color: var(--bento-border-hover);
  transform: scale(1.05);
}
.dock-ico-btn.btn-danger-ico:hover {
  color: var(--color-red);
  background: var(--color-red-bg);
  border-color: var(--color-red-border);
}

/* ── Toast Notification ── */
.bento-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: var(--bento-card-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--bento-border-hover);
  color: var(--text-main);
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
  z-index: 999;
  display: none;
  animation: slide-toast 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.bento-toast.show { display: block; }
@keyframes slide-toast {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.empty-bento {
  grid-column: 1 / -1;
  text-align: center;
  padding: 60px 20px;
  background: var(--bento-card-bg);
  border: 1px dashed var(--bento-border);
  border-radius: 16px;
  color: var(--text-muted);
}
</style>
</head>
<body>

<!-- Floating Toast -->
<div class="bento-toast" id="toast"></div>

<!-- Bento Header -->
<header class="bento-header">
  <div class="brand-section">
    <div class="brand-logo-bento">${I.cloud}</div>
    <div class="brand-titles">
      <h1>Antigravity Codespaces Cloud Hub</h1>
      <p>Multi-Account Cloud Workspace Director &nbsp;·&nbsp; by <span class="brand-author">Nirbhay hiwse</span></p>
    </div>
  </div>
  <div class="header-actions-group">
    <button class="bento-btn btn-primary" onclick="vsc('createCodespace')">
      ${I.plus} <span>New Codespace</span>
    </button>
    <button class="bento-btn btn-ghost" onclick="vsc('syncAllSSH')">
      ${I.sync} <span>Sync SSH</span>
    </button>
    <button class="bento-btn btn-ghost" onclick="vsc('refresh')">
      ${I.refresh} <span>Refresh</span>
    </button>
    <button class="theme-toggle-btn" id="themeToggleBtn" onclick="toggleTheme()" title="Toggle Dark / Light Mode">
      <span id="themeIco">${I.moon || `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`}</span>
    </button>
  </div>
</header>

<!-- Bento Metric Tiles -->
<section class="bento-metrics-grid">
  <div class="metric-tile">
    <div class="metric-header">
      <span class="metric-label">Total Workspaces</span>
      <span class="metric-ico">${I.server}</span>
    </div>
    <div class="metric-value">${total}</div>
  </div>
  <div class="metric-tile">
    <div class="metric-header">
      <span class="metric-label">Running Instances</span>
      <span class="metric-ico" style="color:var(--color-green);">${I.power}</span>
    </div>
    <div class="metric-value val-running">${online}</div>
  </div>
  <div class="metric-tile">
    <div class="metric-header">
      <span class="metric-label">Stopped (Saved)</span>
      <span class="metric-ico">${I.clock}</span>
    </div>
    <div class="metric-value val-stopped">${offline}</div>
  </div>
  <div class="metric-tile">
    <div class="metric-header">
      <span class="metric-label">GitHub Accounts</span>
      <span class="metric-ico">${I.user}</span>
    </div>
    <div class="metric-value">${accountsData.length}</div>
  </div>
</section>

<!-- Bento Filter & Search Toolbar -->
<section class="bento-toolbar">
  <div class="account-chips-wrap">
    <button class="bento-chip active" onclick="setFilter('ALL')" data-acc="ALL">
      <span class="chip-avatar">ALL</span>
      <span class="chip-name">All Accounts</span>
      <span class="chip-count">${flat.length}</span>
    </button>
    ${accountChips}
  </div>

  <div class="search-and-status">
    <div class="bento-search-box">
      <span class="bento-search-ico">${I.search}</span>
      <input type="text" id="q" placeholder="Search by name, repository, branch..." oninput="filterCards()">
    </div>
  </div>
</section>

<!-- Bento Cards Grid -->
<main class="bento-cards-grid" id="grid">
  ${cards || `<div class="empty-bento">No Codespaces found. Click "New Codespace" to provision one.</div>`}
</main>

<script>
const vscode = acquireVsCodeApi();

function vsc(cmd, data) { vscode.postMessage({ command: cmd, ...data }); }
function csCmd(cmd, name, account, repo) {
  if (cmd === 'copySSH') {
    showToast('Copied SSH command: gh cs ssh -c ' + name);
  }
  vscode.postMessage({ command: cmd, name, account, repo });
}

let activeFilter = 'ALL';
function setFilter(acc) {
  activeFilter = acc;
  document.querySelectorAll('.bento-chip').forEach(t => t.classList.toggle('active', t.dataset.acc === acc));
  filterCards();
}

function filterCards() {
  const q = (document.getElementById('q').value || '').toLowerCase();
  document.querySelectorAll('.bento-card').forEach(c => {
    const matchAcc = (activeFilter === 'ALL' || c.dataset.account === activeFilter);
    const matchQ = !q || c.dataset.name.toLowerCase().includes(q) || c.textContent.toLowerCase().includes(q);
    c.style.display = (matchAcc && matchQ) ? '' : 'none';
  });
}

function showToast(msg, ms = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

// ── Theme Switcher (Dark / Light) ──
function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  
  const ico = document.getElementById('themeIco');
  if (next === 'light') {
    ico.innerHTML = \`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>\`;
    showToast('Switched to Light Mode');
  } else {
    ico.innerHTML = \`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>\`;
    showToast('Switched to Dark Mode');
  }
}

// ── Keyboard Shortcuts (Fast Navigation) ──
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== document.getElementById('q')) {
    e.preventDefault();
    const qInput = document.getElementById('q');
    if (qInput) { qInput.focus(); qInput.select(); }
  } else if (e.key === 'Escape') {
    const qInput = document.getElementById('q');
    if (qInput && document.activeElement === qInput) {
      qInput.value = '';
      filterCards();
      qInput.blur();
    }
  }
});
</script>
</body>
</html>`;
}

// ─── Extension Activate ───────────────────────────────────────────────────────
async function activate(context) {
    const sidebarProvider = new CodespacesSidebarProvider(context.extensionUri);

    // ── Status Bar Item ───────────────────────────────────────────────────────
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'antigravity-codespaces.quickMenu';
    statusBarItem.text = '$(cloud) Codespaces';
    statusBarItem.tooltip = 'Antigravity Codespaces Pro — Click for Quick Menu & Cloud Hub';
    
    const initialConfig = vscode.workspace.getConfiguration('antigravity-codespaces');
    if (initialConfig.get('showStatusBarItem', true)) {
        statusBarItem.show();
    }
    context.subscriptions.push(statusBarItem);

    async function updateStatusBar() {
        try {
            const accounts = await sidebarProvider.getAccounts();
            let runningCount = 0;
            for (const acc of accounts) {
                const list = await sidebarProvider.fetchCodespaces(acc);
                runningCount += list.filter(c => c.state === 'Available').length;
            }
            if (runningCount > 0) {
                statusBarItem.text = `$(cloud) Codespaces: ${runningCount} Online`;
                statusBarItem.tooltip = `Antigravity Codespaces: ${runningCount} cloud environment(s) online. Click for quick actions.`;
            } else {
                statusBarItem.text = `$(cloud) Codespaces`;
                statusBarItem.tooltip = `Antigravity Codespaces: Click for quick actions & Cloud Hub`;
            }
        } catch {}
    }

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'antigravity-codespaces-view',
            sidebarProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // ── Dashboard Webview Panel Command ───────────────────────────────────────
    let dashPanel = null;

    async function openOrRefreshDashboard() {
        if (!dashPanel) {
            dashPanel = vscode.window.createWebviewPanel(
                'csHub', 'Codespaces Cloud Hub', vscode.ViewColumn.One,
                { enableScripts: true, retainContextWhenHidden: true }
            );
            dashPanel.onDidDispose(() => { dashPanel = null; });

            dashPanel.webview.onDidReceiveMessage(async (msg) => {
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
                        setTimeout(() => refreshDashHtml(), 2500);
                        break;
                    case 'stop':
                        await vscode.commands.executeCommand('antigravity-codespaces.stop', {
                            codespaceData: { name: msg.name, account: msg.account }
                        });
                        setTimeout(() => refreshDashHtml(), 1500);
                        break;
                    case 'rebuild':
                        await vscode.commands.executeCommand('antigravity-codespaces.rebuild', {
                            codespaceData: { name: msg.name, account: msg.account }
                        });
                        break;
                    case 'openWeb':
                        await vscode.commands.executeCommand('antigravity-codespaces.openInBrowser', {
                            codespaceData: { name: msg.name }
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
                        setTimeout(() => refreshDashHtml(), 1500);
                        break;
                    case 'testSSH':
                        await vscode.commands.executeCommand('antigravity-codespaces.testSSH', {
                            codespaceData: { name: msg.name, account: msg.account }
                        });
                        break;
                    case 'syncAllSSH':
                        await vscode.commands.executeCommand('antigravity-codespaces.syncAllSSH');
                        break;
                    case 'refresh':
                        sidebarProvider.refresh();
                        await refreshDashHtml();
                        updateStatusBar();
                        break;
                    case 'createCodespace':
                        await vscode.commands.executeCommand('antigravity-codespaces.createCodespace');
                        setTimeout(() => refreshDashHtml(), 3000);
                        break;
                }
            });
        } else {
            dashPanel.reveal(vscode.ViewColumn.One);
        }
        await refreshDashHtml();
    }

    async function refreshDashHtml() {
        if (!dashPanel) return;
        try {
            const accounts = await sidebarProvider.getAccounts();
            if (accounts.length === 0) {
                dashPanel.webview.html = buildDashboardHtml([], sidebarProvider.activeAccount);
                return;
            }
            const all = [];
            for (const acc of accounts) {
                const list = await sidebarProvider.fetchCodespaces(acc);
                all.push({ account: acc, codespaces: list });
            }
            dashPanel.webview.html = buildDashboardHtml(all, sidebarProvider.activeAccount);
            updateStatusBar();
        } catch (e) {
            dashPanel.webview.html = `<body style="background:#0d0f1a;color:#ef4444;padding:20px;font-family:sans-serif">
                <h2>Failed to load dashboard</h2><pre style="color:#8890bb;margin-top:12px">${e.message}</pre>
            </body>`;
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.openDashboard', openOrRefreshDashboard)
    );

    // ── Quick Connect (Alt+C) ─────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.quickConnect', async () => {
            const accounts = await sidebarProvider.getAccounts();
            if (!accounts.length) {
                vscode.window.showWarningMessage('No GitHub accounts found. Run: gh auth login -s codespace');
                return;
            }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'Fetching Codespaces…' },
                async () => {
                    const allCs = [];
                    for (const acc of accounts) {
                        const list = await sidebarProvider.fetchCodespaces(acc);
                        list.forEach(c => allCs.push({ ...c, account: acc }));
                    }

                    if (allCs.length === 0) {
                        const create = await vscode.window.showInformationMessage('No active Codespaces found.', 'Create New Codespace');
                        if (create) vscode.commands.executeCommand('antigravity-codespaces.createCodespace');
                        return;
                    }

                    allCs.sort((a, b) => {
                        if (a.state === 'Available' && b.state !== 'Available') return -1;
                        if (b.state === 'Available' && a.state !== 'Available') return 1;
                        return new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0);
                    });

                    const items = allCs.map(cs => {
                        const isOnline = cs.state === 'Available';
                        const icon = isOnline ? '$(debug-start)' : '$(debug-stop)';
                        const stateLabel = isOnline ? 'ONLINE' : 'STOPPED';
                        return {
                            label: `${icon} ${cs.displayName || cs.name}`,
                            description: `[${stateLabel}] ${cs.repository || cs.name} (${cs.account})`,
                            detail: `Branch: ${cs.gitStatus?.ref || 'main'} | Last active: ${formatRelativeTime(cs.lastUsedAt)}`,
                            cs
                        };
                    });

                    items.push({
                        label: '$(plus) Create New Codespace...',
                        description: 'Provision a new cloud developer VM',
                        isCreate: true
                    });
                    items.push({
                        label: '$(layout-sidebar-left) Open Cloud Hub Dashboard',
                        description: 'View full Bento visual grid',
                        isDash: true
                    });

                    const pick = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select a GitHub Codespace to connect immediately (Alt+C)',
                        matchOnDescription: true,
                        matchOnDetail: true
                    });

                    if (!pick) return;
                    if (pick.isCreate) {
                        vscode.commands.executeCommand('antigravity-codespaces.createCodespace');
                    } else if (pick.isDash) {
                        vscode.commands.executeCommand('antigravity-codespaces.openDashboard');
                    } else if (pick.cs) {
                        vscode.commands.executeCommand('antigravity-codespaces.connect', {
                            codespaceData: { name: pick.cs.name, account: pick.cs.account, repository: pick.cs.repository }
                        });
                    }
                }
            );
        })
    );

    // ── Quick Actions Menu ────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.quickMenu', async () => {
            const active = sidebarProvider.activeAccount || 'None';
            const picks = [
                { label: '$(play) Quick Connect to Codespace...', action: 'quickConnect', description: 'Alt+C — Connect in 1 click' },
                { label: '$(layout-sidebar-left) Open Cloud Hub Dashboard', action: 'dashboard', description: 'Full visual management board' },
                { label: '$(account) Switch Active GitHub Account', action: 'switchAccount', description: `Currently active: ${active}` },
                { label: '$(plus) Create New Codespace...', action: 'create', description: 'Pick repository and launch' },
                { label: '$(cloud-upload) Sync SSH Config', action: 'syncSSH', description: 'Write ProxyCommand entries to ~/.ssh/config' },
                { label: '$(zap) Test SSH Connectivity', action: 'testSSH', description: 'Verify latency and tunnel health' },
                { label: '$(refresh) Refresh All Statuses', action: 'refresh', description: 'Query latest machine states' }
            ];

            const sel = await vscode.window.showQuickPick(picks, { placeHolder: 'Antigravity Codespaces Pro — Quick Actions' });
            if (!sel) return;

            switch (sel.action) {
                case 'quickConnect': vscode.commands.executeCommand('antigravity-codespaces.quickConnect'); break;
                case 'dashboard': vscode.commands.executeCommand('antigravity-codespaces.openDashboard'); break;
                case 'switchAccount': vscode.commands.executeCommand('antigravity-codespaces.switchAccount'); break;
                case 'create': vscode.commands.executeCommand('antigravity-codespaces.createCodespace'); break;
                case 'syncSSH': vscode.commands.executeCommand('antigravity-codespaces.syncAllSSH'); break;
                case 'testSSH': vscode.commands.executeCommand('antigravity-codespaces.testSSH'); break;
                case 'refresh': vscode.commands.executeCommand('antigravity-codespaces.refresh'); break;
            }
        })
    );

    // ── Test SSH Connectivity ─────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.testSSH', async (item) => {
            let cs = item?.codespaceData;
            if (!cs) {
                const accounts = await sidebarProvider.getAccounts();
                const all = [];
                for (const acc of accounts) {
                    const list = await sidebarProvider.fetchCodespaces(acc);
                    list.forEach(c => all.push({ ...c, account: acc }));
                }
                if (!all.length) {
                    vscode.window.showWarningMessage('No Codespaces found to test.');
                    return;
                }
                const pick = await vscode.window.showQuickPick(
                    all.map(c => ({
                        label: `$(server) ${c.displayName || c.name}`,
                        description: `${c.repository} (${c.state})`,
                        cs: c
                    })),
                    { placeHolder: 'Select Codespace to test SSH connectivity' }
                );
                if (!pick) return;
                cs = pick.cs;
            }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Testing SSH tunnel to ${cs.displayName || cs.name}…`, cancellable: false },
                async () => {
                    const start = Date.now();
                    try {
                        const token = await getAccountToken(cs.account);
                        const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
                        await runCommand(GH_PATH, ['cs', 'ssh', '-c', cs.name, '--', 'echo', 'ping_ok'], 20000, envOpts);
                        const latency = Date.now() - start;
                        vscode.window.showInformationMessage(`✅ SSH tunnel to "${cs.displayName || cs.name}" is healthy! Latency: ${latency}ms`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`SSH test failed for ${cs.displayName || cs.name}: ${e.message}`);
                    }
                }
            );
        })
    );

    // ── Refresh ───────────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.refresh', async () => {
            await sidebarProvider.refresh();
            await updateStatusBar();
            vscode.window.showInformationMessage('Codespaces refreshed.');
        })
    );

    // ── Switch account ────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.switchAccount', async () => {
            const accounts = await sidebarProvider.getAccounts();
            if (!accounts.length) {
                vscode.window.showWarningMessage('No GitHub accounts found. Run: gh auth login -s codespace');
                return;
            }

            const picks = [
                ...accounts.map(a => ({
                    label: `$(person) ${a}`,
                    acc: a,
                    description: a === sidebarProvider.activeAccount ? '(Active)' : ''
                })),
                { label: '$(key) Add another GitHub Account', isAdd: true }
            ];
            const sel = await vscode.window.showQuickPick(picks, { placeHolder: 'Switch GitHub account' });
            if (!sel) return;

            if (sel.isAdd) {
                vscode.commands.executeCommand('antigravity-codespaces.loginGitHub');
                return;
            }

            try {
                await runCommand(GH_PATH, ['auth', 'switch', '--hostname', 'github.com', '--user', sel.acc]);
                sidebarProvider.activeAccount = sel.acc;
                sidebarProvider.refresh();
                await updateStatusBar();
                vscode.window.showInformationMessage(`Switched active account to: ${sel.acc}`);
            } catch (e) {
                vscode.window.showErrorMessage(`Switch failed: ${e.message}`);
            }
        })
    );

    // ── Create Codespace (with repo picker) ───────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.createCodespace', async () => {
            const accounts = await sidebarProvider.getAccounts();
            if (!accounts.length) {
                vscode.window.showWarningMessage('Login first: gh auth login -s codespace');
                return;
            }

            const accPick = await vscode.window.showQuickPick(
                accounts.map(a => ({
                    label: `$(person) ${a}`,
                    acc: a,
                    description: a === sidebarProvider.activeAccount ? '(Active)' : ''
                })),
                { placeHolder: 'Select GitHub account' }
            );
            if (!accPick) return;

            vscode.window.showInformationMessage(`Loading repositories for ${accPick.acc}...`);
            const repos = await fetchUserRepos(accPick.acc);

            let repoValue;
            if (repos.length > 0) {
                const repoPick = await vscode.window.showQuickPick(
                    [
                        ...repos.map(r => ({
                            label: `$(repo) ${r.name}`,
                            description: r.isPrivate ? 'Private' : 'Public',
                            val: r.nameWithOwner
                        })),
                        { label: '$(pencil) Enter repository manually...', isManual: true }
                    ],
                    { placeHolder: 'Select repository' }
                );
                if (!repoPick) return;
                if (repoPick.isManual) {
                    repoValue = await vscode.window.showInputBox({ prompt: 'Enter owner/repo', placeHolder: 'owner/repo-name' });
                } else {
                    repoValue = repoPick.val;
                }
            } else {
                repoValue = await vscode.window.showInputBox({ prompt: 'Enter owner/repo', placeHolder: 'owner/repo-name' });
            }
            if (!repoValue) return;

            const branch = await vscode.window.showInputBox({ prompt: 'Branch name (leave empty for default)', placeHolder: 'main' });

            await handleCreateCodespace(accPick.acc, repoValue, branch || '');
            sidebarProvider.refresh();
            await updateStatusBar();
        })
    );

    // ── Connect ───────────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.connect', async (item) => {
            if (isConnecting) {
                vscode.window.showInformationMessage('Connection already in progress...');
                return;
            }
            const cs = item?.codespaceData;
            if (!cs) return;
            isConnecting = true;

            const account = cs.account || sidebarProvider.activeAccount;

            try {
                await runCommand(GH_PATH, ['auth', 'switch', '--hostname', 'github.com', '--user', account], 4000).catch(() => {});
                const hostAlias = ensureSSHConfigEntry(cs, account);
                
                let repoName = cs.repository;
                if (!repoName || repoName === cs.name) {
                    try {
                        const token = await getAccountToken(account);
                        const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
                        const viewRaw = await runCommand(GH_PATH, ['codespace', 'view', '-c', cs.name, '--json', 'repository'], 5000, envOpts);
                        const viewObj = JSON.parse(viewRaw || '{}');
                        if (viewObj.repository) repoName = viewObj.repository;
                    } catch {}
                }
                const repoShort = (repoName || '').split('/').pop();
                const remoteFolder = repoShort ? `/workspaces/${repoShort}` : `/workspaces`;

                // Wake if stopped
                if (cs.state !== 'Available') {
                    await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: `Waking up ${cs.displayName || cs.name}…`, cancellable: false },
                        () => runCommand(GH_PATH, ['cs', 'ssh', '-c', cs.name, '--', 'echo', 'up'], 30000)
                    ).catch(() => {});
                }

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Connecting to ${cs.displayName || cs.name}…`, cancellable: false },
                    async (progress) => {
                        progress.report({ message: 'Opening remote workspace in Antigravity…' });
                        let connected = false;

                        // 1. Direct URI
                        try {
                            await vscode.commands.executeCommand('vscode.openFolder',
                                vscode.Uri.from({ scheme: 'vscode-remote', authority: `ssh-remote+${hostAlias}`, path: remoteFolder }),
                                { forceNewWindow: true }
                            );
                            connected = true;
                        } catch {}

                        // 2. Extension commands
                        if (!connected) {
                            const allCmds = await vscode.commands.getCommands();
                            for (const cmd of ['open-remote-ssh.connectToHostInNewWindow', 'vsx-remote-ssh.connectHost', 'remote-ssh.connectHost']) {
                                if (allCmds.includes(cmd)) {
                                    try {
                                        await vscode.commands.executeCommand(cmd, hostAlias);
                                        connected = true;
                                        break;
                                    } catch {}
                                }
                            }
                        }

                        // 3. Binary fallback
                        if (!connected && fs.existsSync(ANTIGRAVITY_EXE)) {
                            exec(`"${ANTIGRAVITY_EXE}" --folder-uri "vscode-remote://ssh-remote+${hostAlias}${remoteFolder}"`, { windowsHide: true });
                            connected = true;
                        }

                        // 4. Terminal SSH fallback
                        if (!connected) {
                            const t = vscode.window.createTerminal(`SSH: ${cs.displayName}`);
                            t.show();
                            t.sendText(`gh cs ssh -c ${cs.name}`);
                        }

                        sidebarProvider.refresh();
                        await updateStatusBar();
                    }
                );
            } catch (e) {
                vscode.window.showErrorMessage(`Connection error: ${e.message}`);
            } finally {
                isConnecting = false;
            }
        })
    );

    // ── Start / Wake ──────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.start', async (item) => {
            const cs = item?.codespaceData;
            if (!cs) return;
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Waking up ${cs.displayName || cs.name}…`, cancellable: false },
                async () => {
                    try {
                        const token = await getAccountToken(cs.account);
                        const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
                        await runCommand(GH_PATH, ['cs', 'ssh', '-c', cs.name, '--', 'echo', 'up'], 30000, envOpts);
                        vscode.window.showInformationMessage(`${cs.displayName || cs.name} is now online!`);
                        sidebarProvider.refresh();
                        await updateStatusBar();
                    } catch (e) {
                        vscode.window.showErrorMessage(`Could not start: ${e.message}`);
                    }
                }
            );
        })
    );

    // ── Stop ──────────────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.stop', async (item) => {
            const cs = item?.codespaceData;
            if (!cs) return;
            try {
                const token = await getAccountToken(cs.account);
                const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
                await runCommand(GH_PATH, ['codespace', 'stop', '-c', cs.name], 12000, envOpts);
                vscode.window.showInformationMessage(`Stopped ${cs.displayName || cs.name}.`);
                sidebarProvider.refresh();
                await updateStatusBar();
            } catch (e) {
                vscode.window.showErrorMessage(`Stop failed: ${e.message}`);
            }
        })
    );

    // ── Rebuild ───────────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.rebuild', async (item) => {
            const cs = item?.codespaceData;
            if (!cs) return;
            const mode = await vscode.window.showQuickPick([
                { label: '$(debug-start) Standard Rebuild', desc: 'Uses layer cache', full: false },
                { label: '$(symbol-event) Full Rebuild (no cache)', desc: 'Clean container rebuild', full: true }
            ], { placeHolder: `Rebuild ${cs.displayName || cs.name}?` });
            if (!mode) return;
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Rebuilding ${cs.displayName || cs.name}…`, cancellable: false },
                async () => {
                    try {
                        const token = await getAccountToken(cs.account);
                        const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
                        const args = ['codespace', 'rebuild', '-c', cs.name, ...(mode.full ? ['--full'] : [])];
                        await runCommand(GH_PATH, args, 60000, envOpts);
                        vscode.window.showInformationMessage(`Rebuild started for ${cs.displayName || cs.name}.`);
                        sidebarProvider.refresh();
                    } catch (e) {
                        vscode.window.showErrorMessage(`Rebuild failed: ${e.message}`);
                    }
                }
            );
        })
    );

    // ── Delete ────────────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.deleteCodespace', async (item) => {
            const cs = item?.codespaceData;
            if (!cs) return;
            const ok = await vscode.window.showWarningMessage(
                `Delete "${cs.displayName || cs.name}"? This is permanent.`, { modal: true }, 'Delete'
            );
            if (ok !== 'Delete') return;
            try {
                const token = await getAccountToken(cs.account);
                const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
                await runCommand(GH_PATH, ['codespace', 'delete', '-c', cs.name, '--force'], 12000, envOpts);
                vscode.window.showInformationMessage(`Deleted ${cs.displayName || cs.name}.`);
                sidebarProvider.refresh();
                await updateStatusBar();
            } catch (e) {
                vscode.window.showErrorMessage(`Delete failed: ${e.message}`);
            }
        })
    );

    // ── Copy SSH ──────────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.copySSHCommand', (item) => {
            const cs = item?.codespaceData;
            if (!cs) return;
            const cmd = `gh cs ssh -c ${cs.name}`;
            vscode.env.clipboard.writeText(cmd);
            vscode.window.showInformationMessage(`Copied: ${cmd}`);
        })
    );

    // ── Open in Browser ───────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.openInBrowser', (item) => {
            const cs = item?.codespaceData;
            if (!cs) return;
            vscode.env.openExternal(vscode.Uri.parse(`https://github.com/codespaces/${cs.name}`));
        })
    );

    // ── Open Port URL ─────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.openPortUrl', (url) => {
            if (url) vscode.env.openExternal(vscode.Uri.parse(url));
        })
    );

    // ── Login ─────────────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.loginGitHub', () => {
            const t = vscode.window.createTerminal('GitHub Login');
            t.show();
            t.sendText('gh auth login -s codespace -w');
            vscode.window.showInformationMessage('Complete GitHub auth in browser, then click Refresh.');
        })
    );

    // ── Sync All SSH ──────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.syncAllSSH', async () => {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Syncing all Codespaces to ~/.ssh/config…', cancellable: false },
                async () => {
                    const accounts = await sidebarProvider.getAccounts();
                    let n = 0;
                    for (const acc of accounts) {
                        try {
                            const list = await sidebarProvider.fetchCodespaces(acc);
                            list.forEach(cs => { ensureSSHConfigEntry(cs, acc); n++; });
                        } catch {}
                    }
                    vscode.window.showInformationMessage(`Synced ${n} Codespace SSH entries to ~/.ssh/config`);
                    sidebarProvider.refresh();
                    await updateStatusBar();
                }
            );
        })
    );

    // ── Startup Auto-Sync & Status Bar Init ───────────────────────────────────
    const startupCfg = vscode.workspace.getConfiguration('antigravity-codespaces');
    if (startupCfg.get('autoSyncSSHOnStartup', true)) {
        setTimeout(async () => {
            try {
                const accounts = await sidebarProvider.getAccounts();
                for (const acc of accounts) {
                    const list = await sidebarProvider.fetchCodespaces(acc);
                    list.forEach(cs => ensureSSHConfigEntry(cs, acc));
                }
                await updateStatusBar();
            } catch {}
        }, 2000);
    } else {
        updateStatusBar();
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function fetchUserRepos(account) {
    try {
        const token = await getAccountToken(account);
        const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
        const raw = await runCommand(GH_PATH, [
            'repo', 'list', '--limit', '100',
            '--json', 'name,nameWithOwner,isPrivate,description'
        ], 12000, envOpts);
        return JSON.parse(raw || '[]');
    } catch {
        return [];
    }
}

async function handleCreateCodespace(account, repo, branch) {
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Creating Codespace on ${repo}…`, cancellable: false },
        async (progress) => {
            try {
                const token = await getAccountToken(account);
                const envOpts = token ? { env: { ...process.env, GH_TOKEN: token } } : {};
                const args = ['codespace', 'create', '-r', repo];
                if (branch) args.push('-b', branch);
                progress.report({ message: 'Provisioning cloud VM (this may take 1-2 minutes)…' });
                const result = await runCommand(GH_PATH, args, 120000, envOpts);
                vscode.window.showInformationMessage(`Created Codespace: ${result}`);
            } catch (e) {
                vscode.window.showErrorMessage(`Create failed: ${e.message}`);
            }
        }
    );
}

function deactivate() {}
module.exports = { activate, deactivate };

