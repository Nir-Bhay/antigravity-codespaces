const vscode = require('vscode');
const { escapeHtml, generateNonce, formatRelativeTime, I } = require('./utils');

class DashboardProvider {
    constructor(context, authManager, githubApi) {
        this._context = context;
        this._authManager = authManager;
        this._githubApi = githubApi;
        this._panel = null;
    }

    async openOrReveal() {
        if (!this._panel) {
            this._panel = vscode.window.createWebviewPanel(
                'csHub',
                'Codespaces Cloud Hub',
                vscode.ViewColumn.One,
                { enableScripts: true, retainContextWhenHidden: true }
            );

            this._panel.onDidDispose(() => {
                this._panel = null;
            });

            this._panel.webview.onDidReceiveMessage(async (msg) => {
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
                        setTimeout(() => this.refreshHtml(), 2000);
                        break;
                    case 'stop':
                        await vscode.commands.executeCommand('antigravity-codespaces.stop', {
                            codespaceData: { name: msg.name, account: msg.account }
                        });
                        setTimeout(() => this.refreshHtml(), 1500);
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
                        setTimeout(() => this.refreshHtml(), 1500);
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
                        await this.refreshHtml();
                        break;
                    case 'createCodespace':
                        await vscode.commands.executeCommand('antigravity-codespaces.createCodespace');
                        setTimeout(() => this.refreshHtml(), 3000);
                        break;
                }
            });
        } else {
            this._panel.reveal(vscode.ViewColumn.One);
        }

        await this.refreshHtml();
    }

    async refreshHtml() {
        if (!this._panel) return;
        try {
            const accounts = await this._authManager.getAccounts();
            if (accounts.length === 0) {
                this._panel.webview.html = this.buildDashboardHtml([], this._authManager.getActiveAccount());
                return;
            }

            const all = [];
            for (const acc of accounts) {
                const list = await this._githubApi.listCodespaces(acc.account);
                all.push({ account: acc.account, codespaces: list });
            }

            this._panel.webview.html = this.buildDashboardHtml(all, this._authManager.getActiveAccount());
        } catch (err) {
            this._panel.webview.html = `
            <body style="background:#090b11;color:#ef4444;padding:24px;font-family:sans-serif">
                <h2>Failed to load Cloud Hub</h2>
                <pre style="color:#94a3b8;margin-top:12px;">${escapeHtml(err.message)}</pre>
            </body>`;
        }
    }

    buildDashboardHtml(accountsData, activeAccount) {
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

        const nonce = generateNonce();

        const accountChips = accountsData.map(({ account, codespaces }) => `
            <button class="bento-chip" data-acc="${escapeHtml(account)}">
                <span class="chip-avatar">${escapeHtml(account.slice(0, 2).toUpperCase())}</span>
                <span class="chip-name">${escapeHtml(account)}</span>
                <span class="chip-count">${codespaces.length}</span>
            </button>`).join('');

        const cards = flat.map(cs => {
            const running = cs.state === 'Available';
            const repo = cs.repository || cs.name;
            const branch = cs.gitStatus?.ref || '—';
            const time = formatRelativeTime(cs.lastUsedAt);
            const idleMins = cs.idleTimeoutMinutes || 30;

            return `
            <article class="bento-card ${running ? 'is-online' : 'is-offline'}" data-account="${escapeHtml(cs.account)}" data-name="${escapeHtml(cs.name)}" data-state="${running ? 'running' : 'stopped'}">
              <div class="bento-card-top">
                <div class="card-title-group">
                  <div class="radar-status ${running ? 'radar-online' : 'radar-offline'}">
                    <span class="radar-dot"></span>
                    ${running ? '<span class="radar-ring"></span>' : ''}
                  </div>
                  <div class="title-meta">
                    <h3 class="codespace-title" title="${escapeHtml(cs.displayName || cs.name)}">${escapeHtml(cs.displayName || cs.name)}</h3>
                    <span class="account-tag" title="GitHub Account: ${escapeHtml(cs.account)}">${escapeHtml(cs.account)}</span>
                  </div>
                </div>
                <div class="badge-status ${running ? 'badge-running' : 'badge-stopped'}">
                  ${running ? 'RUNNING' : 'STOPPED'}
                </div>
              </div>

              <div class="bento-info-box">
                <div class="info-item" title="Repository: ${escapeHtml(repo)}">
                  <span class="info-ico">${I.repo}</span>
                  <span class="info-text">${escapeHtml(repo)}</span>
                </div>
                <div class="info-item" title="Branch: ${escapeHtml(branch)}">
                  <span class="info-ico">${I.branch}</span>
                  <code class="info-branch">${escapeHtml(branch)}</code>
                </div>
                <div class="info-item" title="Last active">
                  <span class="info-ico">${I.clock}</span>
                  <span class="info-text">Active ${escapeHtml(time)}</span>
                </div>
                ${running ? `<div class="info-item" title="Auto-stops after ${idleMins}m inactivity"><span class="info-ico">${I.moon}</span><span class="info-text" style="color:var(--text-subtle);">Idle timeout: ${idleMins}m</span></div>` : ''}
              </div>

              <div class="bento-action-dock">
                <button class="bento-btn btn-primary" data-cmd="connect" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" data-repo="${escapeHtml(repo)}" title="Connect in Antigravity IDE">
                  ${I.play} <span>Connect</span>
                </button>
                ${running
                    ? `<button class="bento-btn btn-power-stop" data-cmd="stop" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Stop Codespace (save hours)">${I.stop} <span>Stop</span></button>`
                    : `<button class="bento-btn btn-power-start" data-cmd="start" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Turn ON Codespace">${I.power} <span>Start</span></button>`}
                
                <div class="btn-dock-icons">
                  <button class="dock-ico-btn" data-cmd="testSSH" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Test SSH Tunnel Latency">
                    ${I.zap}
                  </button>
                  <button class="dock-ico-btn" data-cmd="openWeb" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Open in GitHub Web">
                    ${I.globe}
                  </button>
                  <button class="dock-ico-btn" data-cmd="rebuild" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Rebuild DevContainer">
                    ${I.build}
                  </button>
                  <button class="dock-ico-btn" data-cmd="copySSH" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Copy SSH Command">
                    ${I.term}
                  </button>
                  <button class="dock-ico-btn btn-danger-ico" data-cmd="delete" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Delete Codespace">
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codespaces Cloud Hub</title>
<style nonce="${nonce}">
* { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --mono-font: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

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
  --shadow-card: 0 4px 20px rgba(0, 0, 0, 0.35);
  --shadow-glow: 0 0 25px rgba(56, 139, 253, 0.15);
}

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

.brand-titles h1 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-main);
}
.brand-titles p {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}
.header-actions-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bento-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-primary {
  background: var(--accent-gradient);
  color: #ffffff;
  box-shadow: var(--shadow-glow);
}
.btn-primary:hover { transform: translateY(-1px); opacity: 0.95; }
.btn-ghost {
  background: transparent;
  color: var(--text-main);
  border: 1px solid var(--bento-border);
}
.btn-ghost:hover {
  background: var(--bento-card-hover);
  border-color: var(--bento-border-hover);
}
.theme-toggle-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--bento-border);
  background: transparent;
  color: var(--text-main);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bento-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}
.metric-tile {
  background: var(--bento-bg);
  border: 1px solid var(--bento-border);
  border-radius: 14px;
  padding: 14px 18px;
  box-shadow: var(--shadow-card);
}
.metric-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.metric-value {
  font-size: 26px;
  font-weight: 700;
  color: var(--text-main);
  margin-top: 6px;
}
.val-running { color: var(--color-green); }
.val-stopped { color: var(--text-muted); }

.bento-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.account-chips-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.bento-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 20px;
  background: var(--bento-card-bg);
  border: 1px solid var(--bento-border);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.bento-chip:hover, .bento-chip.active {
  background: var(--accent-gradient);
  color: #ffffff;
  border-color: transparent;
  box-shadow: var(--shadow-glow);
}
.chip-avatar {
  font-size: 9px;
  font-weight: 700;
  background: rgba(255,255,255,0.2);
  padding: 1px 4px;
  border-radius: 4px;
}
.chip-count {
  font-size: 10px;
  background: rgba(0,0,0,0.2);
  padding: 1px 6px;
  border-radius: 10px;
}
.bento-search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 10px;
  padding: 6px 12px;
  min-width: 260px;
}
.bento-search-box input {
  background: transparent;
  border: none;
  color: var(--text-main);
  font-size: 12px;
  outline: none;
  width: 100%;
}

.bento-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}
.bento-card {
  background: var(--bento-card-bg);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--bento-border);
  border-radius: 16px;
  padding: 18px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
.bento-card:hover {
  transform: translateY(-2px);
  border-color: var(--bento-border-hover);
  box-shadow: var(--shadow-card), var(--shadow-glow);
}
.bento-card.is-online { border-top: 3px solid var(--color-green); }
.bento-card.is-offline { border-top: 3px solid var(--text-subtle); }

.bento-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.card-title-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.radar-status {
  position: relative;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.radar-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.radar-online .radar-dot { background: var(--color-green); }
.radar-offline .radar-dot { background: var(--text-subtle); }
.radar-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--color-green);
  animation: radar-pulse 2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}
@keyframes radar-pulse {
  0% { transform: scale(0.6); opacity: 0.9; }
  100% { transform: scale(2.2); opacity: 0; }
}

.title-meta { min-width: 0; }
.codespace-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-tag {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  background: var(--account-tag-bg);
  color: var(--account-tag-color);
  padding: 1px 6px;
  border-radius: 4px;
  margin-top: 2px;
}
.badge-status {
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  text-transform: uppercase;
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

.bento-info-box {
  background: var(--bento-meta-bg);
  border: 1px solid var(--bento-border);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.info-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}
.info-ico { flex-shrink: 0; color: var(--text-subtle); display: flex; }
.info-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.info-branch {
  background: rgba(255,255,255,0.06);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: var(--mono-font);
  font-size: 10px;
  color: var(--text-main);
}

.bento-action-dock {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--bento-border);
}
.btn-power-start {
  background: var(--color-green);
  color: #ffffff;
}
.btn-power-start:hover { background: #2ea043; }
.btn-power-stop {
  background: var(--color-red);
  color: #ffffff;
}
.btn-power-stop:hover { background: #f85149; }

.btn-dock-icons {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dock-ico-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--bento-border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.dock-ico-btn:hover {
  background: var(--bento-card-hover);
  color: var(--text-main);
  border-color: var(--bento-border-hover);
  transform: scale(1.06);
}
.dock-ico-btn.btn-danger-ico:hover {
  color: var(--color-red);
  background: var(--color-red-bg);
  border-color: var(--color-red-border);
}

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
}
.bento-toast.show { display: block; }
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

<div class="bento-toast" id="toast"></div>

<header class="bento-header">
  <div class="brand-section">
    <div class="brand-logo-bento">${I.cloud}</div>
    <div class="brand-titles">
      <h1>Antigravity Codespaces Cloud Hub</h1>
      <p>Multi-Account Cloud Workspace Director &nbsp;·&nbsp; Enterprise Edition</p>
    </div>
  </div>
  <div class="header-actions-group">
    <button class="bento-btn btn-primary" id="hdrNewBtn">
      ${I.plus} <span>New Codespace</span>
    </button>
    <button class="bento-btn btn-ghost" id="hdrSyncBtn">
      ${I.sync} <span>Sync SSH</span>
    </button>
    <button class="bento-btn btn-ghost" id="hdrRefreshBtn">
      ${I.refresh} <span>Refresh</span>
    </button>
    <button class="theme-toggle-btn" id="themeToggleBtn" title="Toggle Dark / Light Theme">
      <span id="themeIco">${I.moon}</span>
    </button>
  </div>
</header>

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
      <span class="metric-label">Storage Tier</span>
      <span class="metric-ico">${I.shield}</span>
    </div>
    <div class="metric-value" style="font-size:18px;margin-top:10px;">15 GB Free Tier</div>
  </div>
</section>

<section class="bento-toolbar">
  <div class="account-chips-wrap">
    <button class="bento-chip active" data-acc="ALL">
      <span class="chip-avatar">ALL</span>
      <span class="chip-name">All Accounts</span>
      <span class="chip-count">${flat.length}</span>
    </button>
    ${accountChips}
  </div>

  <div class="search-and-status">
    <div class="bento-search-box">
      <span class="bento-search-ico">${I.search}</span>
      <input type="text" id="q" placeholder="Search by name, repository, branch... (Press / to focus)">
    </div>
  </div>
</section>

<main class="bento-cards-grid" id="grid">
  ${cards || `<div class="empty-bento">No Codespaces found. Click "New Codespace" to provision one.</div>`}
</main>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

function showToast(msg, ms = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

document.getElementById('hdrNewBtn').addEventListener('click', () => vscode.postMessage({ command: 'createCodespace' }));
document.getElementById('hdrSyncBtn').addEventListener('click', () => vscode.postMessage({ command: 'syncAllSSH' }));
document.getElementById('hdrRefreshBtn').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));

let activeFilter = 'ALL';
function setFilter(acc) {
  activeFilter = acc;
  document.querySelectorAll('.bento-chip').forEach(t => t.classList.toggle('active', t.dataset.acc === acc));
  filterCards();
}

document.querySelectorAll('.bento-chip').forEach(chip => {
  chip.addEventListener('click', () => setFilter(chip.dataset.acc));
});

function filterCards() {
  const q = (document.getElementById('q').value || '').toLowerCase();
  document.querySelectorAll('.bento-card').forEach(c => {
    const matchAcc = (activeFilter === 'ALL' || c.dataset.account === activeFilter);
    const matchQ = !q || c.dataset.name.toLowerCase().includes(q) || c.textContent.toLowerCase().includes(q);
    c.style.display = (matchAcc && matchQ) ? '' : 'none';
  });
}

const qInput = document.getElementById('q');
qInput.addEventListener('input', filterCards);

window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== qInput) {
    e.preventDefault();
    qInput.focus();
    qInput.select();
  } else if (e.key === 'Escape' && document.activeElement === qInput) {
    qInput.value = '';
    filterCards();
    qInput.blur();
  }
});

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.bento-btn, .dock-ico-btn');
  if (btn) {
    const cmd = btn.dataset.cmd;
    const name = btn.dataset.name;
    const account = btn.dataset.acc;
    const repo = btn.dataset.repo;
    if (cmd === 'copySSH') {
      showToast('Copied: gh cs ssh -c ' + name);
    }
    vscode.postMessage({ command: cmd, name, account, repo });
  }
});

// Theme switcher
function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  showToast('Switched to ' + (next === 'light' ? 'Light' : 'Dark') + ' Mode');
}
document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);
</script>
</body>
</html>`;
    }
}

module.exports = { DashboardProvider };
