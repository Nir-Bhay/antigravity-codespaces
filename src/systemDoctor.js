const vscode = require('vscode');
const fs = require('fs');
const { execFile } = require('child_process');
const { findGhExecutable } = require('./sshManager');

class SystemDoctor {
    /**
     * Inspects local environment prerequisites and returns health status.
     * Uses async exec to avoid blocking the VS Code UI thread.
     */
    static async diagnose(authManager) {
        const platform = process.platform;
        const ghPath = findGhExecutable();
        let ghInstalled = false;
        let ghVersion = '';

        // Async gh version check — does NOT block the UI thread
        let ghPathExists = false;
        try { ghPathExists = fs.existsSync(ghPath); } catch {} // safe on UNC paths

        if (ghPathExists || ghPath === 'gh.exe' || ghPath === 'gh') {
            await new Promise((resolve) => {
                execFile(ghPath, ['--version'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
                    if (!err && stdout) {
                        ghInstalled = true;
                        const match = stdout.match(/gh version ([^\s]+)/);
                        ghVersion = match ? match[1] : 'installed';
                    }
                    resolve();
                });
            });
        }

        // Check SSH Remote extension presence (supports standard, Open-VSX, and fork-specific remote-ssh extensions)
        const remoteExts = [
            'jeanp413.open-remote-ssh',
            'ms-vscode-remote.remote-ssh',
            'vsx-remote-ssh.vsx-remote-ssh'
        ];
        const hasRemoteSsh = vscode.extensions.all.some(e =>
            remoteExts.includes(e.id) ||
            e.id.toLowerCase().includes('remote-ssh') ||
            e.id.toLowerCase().includes('open-remote-ssh')
        );

        // Check OpenSSH client (async)
        let hasOpenSsh = false;
        await new Promise((resolve) => {
            const cmd = platform === 'win32' ? 'where.exe' : 'which';
            const args = ['ssh'];
            execFile(cmd, args, { timeout: 3000, windowsHide: true }, (err) => {
                if (!err) hasOpenSsh = true;
                resolve();
            });
        });

        const accounts = await authManager.getAccounts();

        return {
            platform,
            ghInstalled,
            ghVersion,
            ghPath,
            hasRemoteSsh,
            hasOpenSsh,
            hasAccounts: accounts.length > 0,
            accountCount: accounts.length
        };
    }

    /**
     * Guides the user to install GitHub CLI based on their OS.
     */
    static async promptInstallGhCli() {
        const platform = process.platform;
        const options = [];
        if (platform === 'win32') options.push('Install with winget');
        if (platform === 'darwin') options.push('Install with Homebrew');
        options.push('Download from cli.github.com');

        const choice = await vscode.window.showInformationMessage(
            'GitHub CLI (gh) is required to establish encrypted SSH tunnels to Codespaces.',
            ...options
        );

        if (choice === 'Install with winget') {
            const t = vscode.window.createTerminal('Install GitHub CLI');
            t.show();
            t.sendText('winget install --id GitHub.cli -e');
        } else if (choice === 'Install with Homebrew') {
            const t = vscode.window.createTerminal('Install GitHub CLI');
            t.show();
            t.sendText('brew install gh');
        } else if (choice && choice.includes('cli.github.com')) {
            vscode.env.openExternal(vscode.Uri.parse('https://cli.github.com'));
        }
    }

    /**
     * Guides the user to install an SSH Remote extension if missing.
     */
    static async promptInstallRemoteSsh() {
        const choice = await vscode.window.showWarningMessage(
            'Opening remote workspaces in Antigravity IDE requires an SSH Remote extension.',
            'Install Open Remote - SSH',
            'Continue via Integrated Terminal'
        );

        if (choice === 'Install Open Remote - SSH') {
            vscode.commands.executeCommand('workbench.extensions.search', 'open-remote-ssh');
            return true;
        }
        return false;
    }
}

module.exports = { SystemDoctor };
