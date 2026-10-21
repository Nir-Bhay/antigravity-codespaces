const vscode = require('vscode');
const { generateNonce } = require('./utils');
const { buildDashboardHtml } = require('./usageView');

/** "Codespaces: Usage Dashboard" webview panel. */
class UsageDashboard {
    constructor(context, authManager, usageService) {
        this._context = context;
        this._auth = authManager;
        this._usage = usageService;
        this._panel = null;
        usageService.onDidChange(() => { if (this._panel) this.render(); });
    }

    async open() {
        if (this._panel) { this._panel.reveal(); await this.render(); return; }
        this._panel = vscode.window.createWebviewPanel('antigravityUsage', 'Codespaces Usage', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: false });
        this._panel.onDidDispose(() => { this._panel = null; });
        this._panel.webview.onDidReceiveMessage(async (msg) => {
            if (!msg) return;
            if (msg.command === 'refresh') await this._usage.refresh();
            else if (msg.command === 'grant') await vscode.commands.executeCommand('antigravity-codespaces.usageGrantAccess', msg.account);
        });
        await this.render();
    }

    async render() {
        if (!this._panel) return;
        const accounts = await this._auth.getAccounts().catch(() => []);
        const list = await this._usage.getAllUsage(accounts);
        if (this._panel) this._panel.webview.html = buildDashboardHtml(list, generateNonce(), this._panel.webview.cspSource);
    }
}

module.exports = { UsageDashboard };
