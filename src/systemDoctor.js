const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { findGhExecutable, getGhAuthHealth, getSshConfigPath } = require('./sshManager');
const { ensureLinuxRemotePlatform, switchFallbackCommand, PLATFORM_SETTING_SECTION, PLATFORM_SETTING_KEY } = require('./connectPreflight');

class SystemDoctor {
    /**
     * Inspects local environment prerequisites and returns health status.
     * Returns both legacy fields and a structured `checks` array for the Setup Doctor UI.
     * Reuses getGhAuthHealth from sshManager for gh CLI auth state detection.
     */
    static async diagnose(authManager, expectedAccount = null) {
        const platform = process.platform;
        const ghPath = findGhExecutable();
        let ghInstalled = false;
        let ghVersion = '';

        let ghPathExists = false;
        try { ghPathExists = fs.existsSync(ghPath); } catch {}

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

        const remote = SystemDoctor.detectRemoteSsh(vscode.extensions.all.map(e => e.id), vscode.env && vscode.env.appName);
        const hasRemoteSsh = remote.has;

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
        const activeAccount = expectedAccount || authManager.getActiveAccount() || (accounts[0] && accounts[0].account);
        
        const ghAuthHealth = await getGhAuthHealth();
        
        let remotePlatformIssues = [];
        try {
            const config = vscode.workspace.getConfiguration(PLATFORM_SETTING_SECTION);
            const remotePlatform = config.get(PLATFORM_SETTING_KEY) || {};
            for (const [host, plat] of Object.entries(remotePlatform)) {
                if (/^cs[\.-]/.test(host) && plat === 'windows') {
                    remotePlatformIssues.push(host);
                }
            }
        } catch {}
        
        let sshConfigIssues = [];
        try {
            const sshConfigPath = getSshConfigPath();
            if (fs.existsSync(sshConfigPath)) {
                const content = fs.readFileSync(sshConfigPath, 'utf8');
                const hostCounts = {};
                const hostRegex = /^\s*Host\s+(.+)/gim;
                let match;
                while ((match = hostRegex.exec(content)) !== null) {
                    const hosts = match[1].split(/\s+/).filter(h => h && !h.startsWith('#'));
                    for (const h of hosts) {
                        hostCounts[h] = (hostCounts[h] || 0) + 1;
                    }
                }
                for (const [host, count] of Object.entries(hostCounts)) {
                    if (count > 1 && /^cs[\.-]/.test(host)) {
                        sshConfigIssues.push(host);
                    }
                }
            }
        } catch {}
        
        const checks = SystemDoctor._buildChecks({
            platform,
            ghInstalled,
            ghVersion,
            ghPath,
            ghAuthHealth,
            activeAccount,
            hasOpenSsh,
            hasRemoteSsh,
            remoteSshId: remote.id,
            isWindsurf: remote.isWindsurf,
            remotePlatformIssues,
            sshConfigIssues,
            hasAccounts: accounts.length > 0
        });

        return {
            platform,
            ghInstalled,
            ghVersion,
            ghPath,
            ghAuthHealth,
            ghUser: ghAuthHealth.user || null,
            hasCodespaceScope: ghAuthHealth.state === 'ok' && !ghAuthHealth.scopesUnknown,
            hasRemoteSsh,
            hasOpenSsh,
            hasAccounts: accounts.length > 0,
            accountCount: accounts.length,
            activeAccount,
            remotePlatformIssues,
            sshConfigIssues,
            checks
        };
    }

    /**
     * Builds the structured checks array for Setup Doctor UI.
     * Each check: { id, ok, warn, label, detail, fixCommand, fixLabel }
     */
    static _buildChecks(info) {
        const checks = [];
        const platform = info.platform;
        const ghHealth = info.ghAuthHealth || {};
        
        const installCmd = platform === 'win32' ? 'winget install --id GitHub.cli -e' :
                          platform === 'darwin' ? 'brew install gh' : 
                          'sudo apt install gh || sudo dnf install gh';
        
        checks.push({
            id: 'gh_installed',
            ok: info.ghInstalled,
            warn: false,
            label: 'GitHub CLI installed',
            detail: info.ghInstalled ? `gh ${info.ghVersion}` : 'gh CLI not found',
            fixCommand: installCmd,
            fixLabel: 'Install gh CLI',
            fixUrl: 'https://cli.github.com'
        });
        
        if (info.ghInstalled) {
            const isLoggedIn = ghHealth.state !== 'logged_out' && ghHealth.state !== 'missing';
            checks.push({
                id: 'gh_logged_in',
                ok: isLoggedIn,
                warn: false,
                label: 'gh CLI signed in',
                detail: isLoggedIn ? `Signed in as @${ghHealth.user || 'unknown'}` : 'Not signed in to GitHub',
                fixCommand: 'gh auth login -s codespace',
                fixLabel: 'Sign in'
            });
            
            if (isLoggedIn) {
                const hasScope = ghHealth.state === 'ok';
                const scopeUnknown = ghHealth.scopesUnknown;
                checks.push({
                    id: 'gh_codespace_scope',
                    ok: hasScope,
                    warn: !hasScope && !scopeUnknown,
                    label: 'codespace scope granted',
                    detail: hasScope ? (scopeUnknown ? 'Scope check skipped (fine-grained PAT or GH_TOKEN)' : 'Token has codespace permission') : 'Token missing codespace scope',
                    fixCommand: 'gh auth refresh -h github.com -s codespace',
                    fixLabel: 'Grant scope'
                });
                
                const accountMatch = !info.activeAccount || 
                    (ghHealth.user && ghHealth.user.toLowerCase() === info.activeAccount.toLowerCase());
                checks.push({
                    id: 'gh_account_match',
                    ok: accountMatch,
                    warn: !accountMatch,
                    label: 'gh account matches extension',
                    detail: accountMatch ? 
                        (info.activeAccount ? `Both using @${info.activeAccount}` : 'No extension account set') :
                        `gh: @${ghHealth.user || '?'}, extension: @${info.activeAccount || '?'}`,
                    fixCommand: info.activeAccount ? switchFallbackCommand('', info.activeAccount) : null,
                    fixLabel: 'Switch account'
                });
            }
        }
        
        checks.push({
            id: 'openssh_installed',
            ok: info.hasOpenSsh,
            warn: false,
            label: 'OpenSSH client available',
            detail: info.hasOpenSsh ? 'ssh command found' : 'ssh not found in PATH',
            fixCommand: platform === 'win32' ? 'Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0' : null,
            fixLabel: platform === 'win32' ? 'Install OpenSSH' : null,
            fixUrl: platform !== 'win32' ? 'https://www.openssh.com/' : null
        });
        
        checks.push({
            id: 'remote_ssh_extension',
            ok: info.hasRemoteSsh,
            warn: !info.hasRemoteSsh,
            label: 'Remote SSH extension installed',
            detail: info.hasRemoteSsh ? `Extension detected${info.remoteSshId ? ' (' + info.remoteSshId + ')' : ''}` : (info.isWindsurf ? "Windsurf's built-in Remote SSH (codeium.windsurf-remote-openssh) is not enabled. Don't install Microsoft Remote-SSH or open-remote-ssh on Windsurf; they conflict." : 'No Remote SSH extension found'),
            fixLabel: info.isWindsurf ? 'Show Windsurf Remote SSH' : 'Install extension',
            fixExtension: info.isWindsurf ? 'codeium.windsurf-remote-openssh' : 'jeanp413.open-remote-ssh'
        });
        
        if (info.remotePlatformIssues && info.remotePlatformIssues.length > 0) {
            checks.push({
                id: 'remote_platform',
                ok: false,
                warn: true,
                label: 'remotePlatform setting',
                detail: `${info.remotePlatformIssues.length} codespace host(s) set to windows instead of linux`,
                fixSetting: `${PLATFORM_SETTING_SECTION}.${PLATFORM_SETTING_KEY}`,
                fixLabel: 'Fix setting',
                affectedHosts: info.remotePlatformIssues
            });
        } else {
            checks.push({
                id: 'remote_platform',
                ok: true,
                warn: false,
                label: 'remotePlatform setting',
                detail: 'No misconfigured codespace hosts'
            });
        }
        
        if (info.sshConfigIssues && info.sshConfigIssues.length > 0) {
            checks.push({
                id: 'ssh_config_duplicates',
                ok: false,
                warn: true,
                label: 'SSH config (duplicates)',
                detail: `${info.sshConfigIssues.length} duplicate host block(s) found`,
                fixCommand: null,
                fixLabel: 'Run Sync SSH'
            });
        } else {
            checks.push({
                id: 'ssh_config_duplicates',
                ok: true,
                warn: false,
                label: 'SSH config (no duplicates)',
                detail: 'No duplicate codespace host blocks'
            });
        }
        
        return checks;
    }

    /**
     * Generates a diagnostic report for clipboard/issue filing.
     * Redacts tokens and sensitive data.
     * Includes: extension, IDE, OS and gh versions, redacted gh auth status,
     * gh path, codespace SSH config blocks, last Doctor results, last tunnel stderr.
     */
    static async generateReport(authManager, opts = {}) {
        const diag = await SystemDoctor.diagnose(authManager);
        const ghHealth = diag.ghAuthHealth || {};
        
        // Get OS version
        const osRelease = os.release();
        const osType = os.type();
        const osPlatform = os.platform();
        const osArch = os.arch();
        
        // Get redacted gh auth status (no tokens)
        let ghAuthStatusRedacted = 'Not available';
        if (diag.ghInstalled) {
            try {
                const { runCommand } = require('./utils');
                const ghExe = findGhExecutable();
                const statusOut = await runCommand(ghExe, ['auth', 'status'], 5000).catch(() => '');
                ghAuthStatusRedacted = SystemDoctor._redactAuthStatus(statusOut);
            } catch {}
        }
        
        // Get codespace SSH config blocks
        let sshConfigBlocks = 'Not available';
        try {
            const sshConfigPath = getSshConfigPath();
            if (fs.existsSync(sshConfigPath)) {
                const content = fs.readFileSync(sshConfigPath, 'utf8');
                const csBlocks = SystemDoctor._extractCodespaceBlocks(content);
                sshConfigBlocks = csBlocks.length > 0 ? csBlocks.join('\n\n') : 'No codespace blocks found';
            }
        } catch {}
        
        // Get last tunnel stderr from global state if available
        const lastTunnelStderr = opts.lastTunnelStderr || SystemDoctor._lastTunnelStderr || 'No recent tunnel errors';
        
        const lines = [
            '# Antigravity Codespaces Diagnostic Report',
            `Generated: ${new Date().toISOString()}`,
            '',
            '## Environment',
            `- OS: ${osType} ${osRelease} (${osPlatform}/${osArch})`,
            `- IDE: ${vscode.env.appName} ${vscode.version}`,
            `- Extension: Antigravity Codespaces Pro v5.0.8`,
            `- Node: ${process.version}`,
            '',
            '## GitHub CLI',
            `- Installed: ${diag.ghInstalled ? 'Yes' : 'No'}`,
            `- Version: ${diag.ghVersion || 'N/A'}`,
            `- Path: ${diag.ghPath || 'N/A'}`,
            `- Auth State: ${ghHealth.state || 'unknown'}`,
            `- Active User: ${ghHealth.user ? '@' + ghHealth.user : 'N/A'}`,
            `- Codespace Scope: ${ghHealth.state === 'ok' ? (ghHealth.scopesUnknown ? 'Unknown (fine-grained PAT)' : 'Yes') : 'No'}`,
            '',
            '### gh auth status (redacted)',
            '```',
            ghAuthStatusRedacted,
            '```',
            '',
            '## SSH',
            `- OpenSSH Client: ${diag.hasOpenSsh ? 'Available' : 'Not found'}`,
            `- Remote SSH Extension: ${diag.hasRemoteSsh ? 'Installed' : 'Not found'}`,
            `- SSH Config Issues: ${diag.sshConfigIssues.length > 0 ? diag.sshConfigIssues.join(', ') : 'None'}`,
            `- RemotePlatform Issues: ${diag.remotePlatformIssues.length > 0 ? diag.remotePlatformIssues.join(', ') : 'None'}`,
            '',
            '### Codespace SSH Config Blocks',
            '```',
            sshConfigBlocks,
            '```',
            '',
            '## Accounts',
            `- Extension Accounts: ${diag.accountCount}`,
            `- Active Account: ${diag.activeAccount ? '@' + diag.activeAccount : 'None'}`,
            '',
            '## Setup Doctor Checks'
        ];
        
        for (const check of diag.checks) {
            const icon = check.ok ? '✅' : (check.warn ? '⚠️' : '❌');
            lines.push(`${icon} ${check.label}: ${check.detail}`);
        }
        
        // Add last tunnel stderr
        lines.push('');
        lines.push('## Last Tunnel Error');
        lines.push('```');
        lines.push(lastTunnelStderr);
        lines.push('```');
        
        return lines.join('\n');
    }

    /**
     * Store the last tunnel stderr for diagnostic reports.
     */
    static setLastTunnelStderr(stderr) {
        SystemDoctor._lastTunnelStderr = stderr ? stderr.slice(0, 2000) : null;
    }

    /**
     * Redact tokens and sensitive data from gh auth status output.
     */
    static _redactAuthStatus(statusOutput) {
        if (!statusOutput) return 'No output';
        return statusOutput
            .replace(/gho_[A-Za-z0-9_]+/g, 'gho_[REDACTED]')
            .replace(/ghp_[A-Za-z0-9_]+/g, 'ghp_[REDACTED]')
            .replace(/ghu_[A-Za-z0-9_]+/g, 'ghu_[REDACTED]')
            .replace(/ghs_[A-Za-z0-9_]+/g, 'ghs_[REDACTED]')
            .replace(/ghr_[A-Za-z0-9_]+/g, 'ghr_[REDACTED]')
            .replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_[REDACTED]')
            .replace(/Bearer [A-Za-z0-9_-]+/gi, 'Bearer [REDACTED]')
            .replace(/token: [^\s]+/gi, 'token: [REDACTED]')
            .trim();
    }

    /**
     * Extract codespace-related SSH config blocks.
     */
    static _extractCodespaceBlocks(sshConfig) {
        const blocks = [];
        const lines = sshConfig.split('\n');
        let currentBlock = [];
        let inCsBlock = false;
        
        for (const line of lines) {
            const hostMatch = line.match(/^\s*Host\s+(.+)/i);
            if (hostMatch) {
                if (inCsBlock && currentBlock.length > 0) {
                    blocks.push(currentBlock.join('\n'));
                }
                currentBlock = [line];
                const hosts = hostMatch[1].split(/\s+/);
                inCsBlock = hosts.some(h => /^cs[\.-]/.test(h));
            } else if (currentBlock.length > 0) {
                currentBlock.push(line);
            }
        }
        if (inCsBlock && currentBlock.length > 0) {
            blocks.push(currentBlock.join('\n'));
        }
        
        return blocks.slice(0, 10);
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
     * Which Remote-SSH extension is present. Pure (tested).
     * Windsurf ships its own (codeium.windsurf-remote-openssh); Microsoft/open-remote-ssh conflict with it.
     */
    static detectRemoteSsh(extIds, appName = '') {
        const ids = (extIds || []).map(x => String(x).toLowerCase());
        const isWindsurf = /windsurf/i.test(appName || '');
        const known = ['codeium.windsurf-remote-openssh', 'anysphere.remote-ssh', 'jeanp413.open-remote-ssh', 'ms-vscode-remote.remote-ssh', 'vsx-remote-ssh.vsx-remote-ssh'];
        const id = known.find(k => ids.includes(k)) || ids.find(x => /remote-?(open)?ssh/.test(x)) || '';
        const conflicts = isWindsurf ? ids.filter(x => x === 'ms-vscode-remote.remote-ssh' || x === 'jeanp413.open-remote-ssh') : [];
        return { has: !!id, id, isWindsurf, conflicts };
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

    /**
     * Opens a terminal with a command pre-typed (for fix actions).
     */
    static openTerminalWithCommand(command, title = 'Fix') {
        const t = vscode.window.createTerminal(title);
        t.show();
        t.sendText(command);
        return t;
    }

    /**
     * Fixes the remotePlatform setting for codespace hosts.
     */
    static async fixRemotePlatform(hosts) {
        const config = vscode.workspace.getConfiguration(PLATFORM_SETTING_SECTION);
        for (const host of hosts) {
            await ensureLinuxRemotePlatform(host, {
                config,
                target: vscode.ConfigurationTarget.Global,
                log: (msg) => console.log('[SystemDoctor]', msg)
            });
        }
        return true;
    }
}

module.exports = { SystemDoctor };
