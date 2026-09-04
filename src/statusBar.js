const vscode = require('vscode');

class StatusBarManager {
    constructor(context, authManager, githubApi) {
        this._context = context;
        this._authManager = authManager;
        this._githubApi = githubApi;
        this._inFlight = null;
        this._queued = false;

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

    /**
     * Debounced + coalesced: rapid start/stop/refresh bursts collapse into a
     * single API round-trip instead of hammering the GitHub API.
     */
    async update() {
        if (this._inFlight) {
            this._queued = true;
            return this._inFlight;
        }
        this._inFlight = this._updateNow().finally(() => {
            this._inFlight = null;
            if (this._queued) {
                this._queued = false;
                return this.update();
            }
            return undefined;
        });
        return this._inFlight;
    }

    async _updateNow() {
        try {
            const accounts = await this._authManager.getAccounts();
            if (accounts.length === 0) {
                this._item.text = '$(cloud) Codespaces: Sign In';
                this._item.tooltip = 'Antigravity Codespaces: Click to Sign in to GitHub';
                return;
            }

            const settled = await Promise.all(accounts.map(async (acc) => {
                try {
                    return await this._githubApi.listCodespaces(acc.account);
                } catch {
                    return [];
                }
            }));
            let onlineCount = 0;
            for (const list of settled) {
                onlineCount += list.filter(c => c.state === 'Available').length;
            }

            if (onlineCount > 0) {
                this._item.text = `$(cloud) Codespaces: ${onlineCount} Online`;
                this._item.tooltip = `Antigravity Codespaces: ${onlineCount} cloud environment(s) running. Click for quick actions.`;
            } else {
                this._item.text = '$(cloud) Codespaces';
                this._item.tooltip = 'Antigravity Codespaces: Click for quick actions & Cloud Hub';
            }
        } catch (err) {
            this._item.text = '$(cloud) Codespaces';
            this._item.tooltip = `Antigravity Codespaces: status unavailable (${(err && err.message) || 'unknown error'}). Click to retry.`;
        }
    }
}

module.exports = { StatusBarManager };
