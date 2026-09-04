const vscode = require('vscode');
const fs = require('fs');
const { execSync } = require('child_process');
const { findGhExecutable } = require('./sshManager');

class SystemDoctor {
    /**
     * Inspects local environment prerequisites and returns health status.
     */
    static async diagnose(authManager) {
        const platform = process.platform;
        const ghPath = findGhExecutable();
        let ghInstalled = false;
        let ghVersion = '';

        if (fs.existsSync(ghPath) || ghPath === 'gh.exe' || ghPath === 'gh') {
            try {
                const out = execSync(`"${ghPath}" --version`, { encoding: 'utf8', timeout: 4000, stdio: ['pipe', 'pipe', 'ignore'] });
                ghInstalled = true;
                const match = out.match(/gh version ([^\s]+)/);
                ghVersion = match ? match[1] : 'installed';
            } catch {
                ghInstalled = false;
            }
        }

        // Check SSH Remote extension presence
        const remoteExts = [
            'jeanp413.open-remote-ssh',
            'ms-vscode-remote.remote-ssh',
            'vsx-remote-ssh.vsx-remote-ssh'
        ];
        const hasRemoteSsh = vscode.extensions.all.some(e => remoteExts.includes(e.id));

        // Check OpenSSH client
        let hasOpenSsh = false;
        try {
            const checkSsh = platform === 'win32' ? 'where.exe ssh 2>nul' : 'which ssh 2>/dev/null';
            execSync(checkSsh, { stdio: ['pipe', 'pipe', 'ignore'] });
            hasOpenSsh = true;
        } catch {}

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
