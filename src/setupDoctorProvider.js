const vscode = require('vscode');
const { escapeHtml, generateNonce, I } = require('./utils');
const { SystemDoctor } = require('./systemDoctor');

class SetupDoctorProvider {
    constructor(context, authManager) {
        this._context = context;
        this._authManager = authManager;
        this._panel = null;
    }

    async openOrReveal() {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
            await this._refresh();
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            'antigravity-setup-doctor',
            'Setup Doctor',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._context.extensionUri]
            }
        );

        this._panel.onDidDispose(() => {
            this._panel = null;
        }, null, this._context.subscriptions);

        this._panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'refresh':
                    await this._refresh();
                    break;
                case 'copyReport':
                    try {
                        const report = await SystemDoctor.generateReport(this._authManager);
                        await vscode.env.clipboard.writeText(report);
                        vscode.window.showInformationMessage('Diagnostic report copied to clipboard.');
                    } catch (err) {
                        vscode.window.showErrorMessage(`Failed to copy report: ${err.message}`);
                    }
                    break;
                case 'fix': {
                    const checkId = msg.checkId;
                    const diag = await SystemDoctor.diagnose(this._authManager);
                    const check = diag.checks.find(c => c.id === checkId);
                    if (!check) break;

                    if (check.fixCommand) {
                        SystemDoctor.openTerminalWithCommand(check.fixCommand, check.fixLabel || 'Fix');
                    } else if (check.fixExtension) {
                        vscode.commands.executeCommand('workbench.extensions.search', check.fixExtension);
                    } else if (check.fixUrl) {
                        vscode.env.openExternal(vscode.Uri.parse(check.fixUrl));
                    } else if (checkId === 'remote_platform' && check.affectedHosts) {
                        await SystemDoctor.fixRemotePlatform(check.affectedHosts);
                        vscode.window.showInformationMessage(`Fixed remotePlatform for ${check.affectedHosts.length} host(s).`);
                        await this._refresh();
                    } else if (checkId === 'ssh_config_duplicates') {
                        await vscode.commands.executeCommand('antigravity-codespaces.syncAllSSH');
                        await this._refresh();
                    }
                    break;
                }
                case 'openExternal':
                    if (msg.url && msg.url.startsWith('https://')) {
                        vscode.env.openExternal(vscode.Uri.parse(msg.url));
                    }
                    break;
                default:
                    console.warn(`SetupDoctorProvider: unknown command "${msg.command}"`);
            }
        }, null, this._context.subscriptions);

        await this._refresh();
    }

    async _refresh() {
        if (!this._panel) return;
        const diag = await SystemDoctor.diagnose(this._authManager);
        this._panel.webview.html = this._buildHtml(diag);
    }

    _buildHtml(diag) {
        const nonce = generateNonce();
        const checks = diag.checks || [];
        const allPassed = checks.every(c => c.ok);

        const checkRowsHtml = checks.map(check => {
            let icon, statusClass;
            if (check.ok) {
                icon = I.checkCircle;
                statusClass = 'status-pass';
            } else if (check.warn) {
                icon = I.alertTriangle;
                statusClass = 'status-warn';
            } else {
                icon = I.alertCircle;
                statusClass = 'status-fail';
            }

            let fixBtnHtml = '';
            if (!check.ok && (check.fixCommand || check.fixExtension || check.fixUrl || check.id === 'remote_platform' || check.id === 'ssh_config_duplicates')) {
                fixBtnHtml = `<button class="fix-btn" data-check-id="${escapeHtml(check.id)}">${escapeHtml(check.fixLabel || 'Fix')}</button>`;
            }

            return `
            <div class="check-row ${statusClass}">
                <span class="check-icon">${icon}</span>
                <div class="check-content">
                    <span class="check-label">${escapeHtml(check.label)}</span>
                    <span class="check-detail">${escapeHtml(check.detail)}</span>
                </div>
                ${fixBtnHtml}
            </div>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Setup Doctor</title>
<style nonce="${nonce}">
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 32px;
    max-width: 700px;
    margin: 0 auto;
}
.header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
}
.header-icon {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: ${allPassed ? 'rgba(46, 160, 67, 0.12)' : 'rgba(210, 153, 34, 0.12)'};
    color: ${allPassed ? '#2ea043' : '#d29922'};
    display: flex;
    align-items: center;
    justify-content: center;
}
.header-icon svg { width: 24px; height: 24px; }
.header-text h1 {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 4px;
}
.header-text p {
    font-size: 13px;
    color: var(--vscode-descriptionForeground);
}
.status-banner {
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 10px;
}
.status-banner.banner-pass {
    background: rgba(46, 160, 67, 0.08);
    border: 1px solid rgba(46, 160, 67, 0.25);
}
.status-banner.banner-warn {
    background: rgba(210, 153, 34, 0.08);
    border: 1px solid rgba(210, 153, 34, 0.3);
}
.status-banner.banner-fail {
    background: rgba(207, 34, 46, 0.06);
    border: 1px solid rgba(207, 34, 46, 0.25);
}
.banner-icon { display: flex; flex-shrink: 0; }
.banner-pass .banner-icon { color: #2ea043; }
.banner-warn .banner-icon { color: #d29922; }
.banner-fail .banner-icon { color: #cf222e; }
.banner-text { flex: 1; font-size: 13px; }
.banner-text strong { font-weight: 600; }

.checks-card {
    background: var(--vscode-sideBarSectionHeader-background, rgba(128,128,128,0.05));
    border: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.12));
    border-radius: 8px;
    overflow: hidden;
}
.checks-header {
    padding: 12px 16px;
    font-weight: 600;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.12));
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.checks-header span { font-size: 12px; color: var(--vscode-descriptionForeground); }
.check-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.08));
}
.check-row:last-child { border-bottom: none; }
.check-icon { display: flex; flex-shrink: 0; width: 20px; }
.status-pass .check-icon { color: #2ea043; }
.status-warn .check-icon { color: #d29922; }
.status-fail .check-icon { color: #cf222e; }
.check-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.check-label {
    font-weight: 500;
    font-size: 13px;
}
.check-detail {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.fix-btn {
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-button-secondaryBorder, rgba(128,128,128,0.25));
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s;
}
.fix-btn:hover {
    background: rgba(128,128,128,0.12);
}

.action-row {
    display: flex;
    gap: 10px;
    margin-top: 20px;
}
.action-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
}
.action-btn.primary {
    background: var(--vscode-button-background, #0969da);
    color: var(--vscode-button-foreground, #fff);
    border: none;
}
.action-btn.primary:hover {
    background: var(--vscode-button-hoverBackground, #085cc0);
}
.action-btn.secondary {
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-button-secondaryBorder, rgba(128,128,128,0.25));
}
.action-btn.secondary:hover {
    background: rgba(128,128,128,0.1);
}

.info-section {
    margin-top: 24px;
    padding: 14px 16px;
    background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.04));
    border-left: 3px solid var(--vscode-textLink-foreground, #0969da);
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.5;
}
.info-section a {
    color: var(--vscode-textLink-foreground, #0969da);
    text-decoration: none;
}
.info-section a:hover { text-decoration: underline; }
</style>
</head>
<body>
    <div class="header">
        <div class="header-icon">${allPassed ? I.checkCircle : I.alertTriangle}</div>
        <div class="header-text">
            <h1>Setup Doctor</h1>
            <p>Diagnose and fix common Codespaces SSH issues</p>
        </div>
    </div>

    ${allPassed ? `
    <div class="status-banner banner-pass">
        <span class="banner-icon">${I.checkCircle}</span>
        <span class="banner-text"><strong>All checks passed!</strong> Your environment is ready for Codespaces.</span>
    </div>
    ` : `
    <div class="status-banner ${checks.some(c => !c.ok && !c.warn) ? 'banner-fail' : 'banner-warn'}">
        <span class="banner-icon">${checks.some(c => !c.ok && !c.warn) ? I.alertCircle : I.alertTriangle}</span>
        <span class="banner-text"><strong>Some checks need attention.</strong> Fix the issues below to ensure SSH works reliably.</span>
    </div>
    `}

    <div class="checks-card">
        <div class="checks-header">
            System Checks
            <span>${checks.filter(c => c.ok).length}/${checks.length} passed</span>
        </div>
        ${checkRowsHtml}
    </div>

    <div class="action-row">
        <button class="action-btn primary" id="rerunBtn">
            ${I.refresh}
            <span>Re-run Checks</span>
        </button>
        <button class="action-btn secondary" id="copyBtn">
            ${I.copy}
            <span>Copy Diagnostic Report</span>
        </button>
    </div>

    <div class="info-section">
        <strong>Need help?</strong> Copy the diagnostic report above and paste it when filing an issue or asking for support.
        <br><br>
        <a href="https://cli.github.com" id="ghCliLink">Install GitHub CLI</a> · 
        <a href="https://github.com/codespaces" id="codespacesLink">GitHub Codespaces</a>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        document.getElementById('rerunBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });
        
        document.getElementById('copyBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'copyReport' });
        });
        
        document.querySelectorAll('.fix-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const checkId = btn.dataset.checkId;
                vscode.postMessage({ command: 'fix', checkId });
            });
        });
        
        document.querySelectorAll('.info-section a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                vscode.postMessage({ command: 'openExternal', url: link.href });
            });
        });
    </script>
</body>
</html>`;
    }
}

module.exports = { SetupDoctorProvider };
