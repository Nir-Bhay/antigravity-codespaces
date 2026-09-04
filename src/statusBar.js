const vscode = require('vscode');

class StatusBarManager {
    constructor(context, authManager, githubApi) {
        this._context = context;
        this._authManager = authManager;
        this._githubApi = githubApi;
        
        this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this._item.command = 'antigravity-codespaces.quickMenu';
        this._item.text = '$(cloud) Codespaces';
        this._item.tooltip = 'Antigravity Codespaces Pro — Click for Quick Menu & Cloud Hub';
        
        this.updateVisibility();
        context.subscriptions.push(this._item);
    }

    updateVisibility() {
        const config = vscode.workspace.getConfiguration('antigravity-codespaces');
        const show = config.get('showStatusBarItem', true);
        if (show) {
            this._item.show();
        } else {
            this._item.hide();
        }
    }

    async update() {
        try {
            const accounts = await this._authManager.getAccounts();
            if (accounts.length === 0) {
                this._item.text = '$(cloud) Codespaces: Sign In';
                this._item.tooltip = 'Antigravity Codespaces: Click to Sign in to GitHub';
                return;
            }

            let onlineCount = 0;
            for (const acc of accounts) {
                const list = await this._githubApi.listCodespaces(acc.account);
                onlineCount += list.filter(c => c.state === 'Available').length;
            }

            if (onlineCount > 0) {
                this._item.text = `$(cloud) Codespaces: ${onlineCount} Online`;
                this._item.tooltip = `Antigravity Codespaces: ${onlineCount} cloud environment(s) running. Click for quick actions.`;
            } else {
                this._item.text = '$(cloud) Codespaces';
                this._item.tooltip = 'Antigravity Codespaces: Click for quick actions & Cloud Hub';
            }
        } catch {
            this._item.text = '$(cloud) Codespaces';
        }
    }
}

module.exports = { StatusBarManager };
