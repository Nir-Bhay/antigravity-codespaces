const vscode = require('vscode');
const fs = require('fs');
const { execFile } = require('child_process');

const { friendlyError, formatRelativeTime, runCommand } = require('./src/utils');
const { AuthManager } = require('./src/authManager');
const { GithubApi } = require('./src/githubApi');
const {
    findGhExecutable,
    findAntigravityExecutable,
    ensureSSHConfigEntry,
    testSshTunnel,
    cleanSshConfigFile,
    getGhActiveUser
} = require('./src/sshManager');
const { SystemDoctor } = require('./src/systemDoctor');
const { SidebarProvider } = require('./src/sidebarProvider');
const { DashboardProvider } = require('./src/dashboardProvider');
const { StatusBarManager } = require('./src/statusBar');

// Concurrency tracker for active connections (fixes BUG-13)
const connectingSet = new Set();
let globalAuthManager = null;
let globalGithubApi = null;

/**
 * Extension activation entry point.
 */
async function activate(context) {
    const ANTIGRAVITY_EXE = findAntigravityExecutable(); // Declared and resolved (fixes BUG-02, BUG-04)

    const authManager = new AuthManager(context);
    const githubApi = new GithubApi(authManager);
    globalAuthManager = authManager;
    globalGithubApi = githubApi;

    const statusBar = new StatusBarManager(context, authManager, githubApi);
    const sidebarProvider = new SidebarProvider(context.extensionUri, authManager, githubApi);
    const dashboardProvider = new DashboardProvider(context, authManager, githubApi);

    /**
     * Shared picker for palette-invoked commands that arrive without a webview
     * context item. Previously these commands silently did nothing — now they
     * ask which Codespace to act on. Returns a `{ codespaceData }`-shaped item
     * (matching what the webviews send) or null when cancelled/empty.
     */
    async function pickCodespace(placeHolder) {
        const accounts = await authManager.getAccounts();
        if (!accounts.length) {
            const act = await vscode.window.showWarningMessage('No GitHub accounts found.', 'Sign In');
            if (act === 'Sign In') await authManager.login();
            return null;
        }
        const settled = await Promise.all(accounts.map(async (acc) => {
            try {
                const list = await githubApi.listCodespaces(acc.account);
                return list.map(c => ({ ...c, account: acc.account }));
            } catch {
                return [];
            }
        }));
        const all = settled.flat();
        if (!all.length) {
            vscode.window.showWarningMessage('No Codespaces found for any account.');
            return null;
        }
        all.sort((a, b) => {
            if (a.state === 'Available' && b.state !== 'Available') return -1;
            if (b.state === 'Available' && a.state !== 'Available') return 1;
            return new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0);
        });
        const pick = await vscode.window.showQuickPick(
            all.map(c => ({
                label: `${c.state === 'Available' ? '$(debug-start)' : '$(debug-stop)'} ${c.displayName || c.name}`,
                description: `${c.repository || c.name} (${c.account})`,
                cs: c
            })),
            { placeHolder: placeHolder || 'Select a Codespace' }
        );
        if (!pick) return null;
        return {
            codespaceData: {
                name: pick.cs.name,
                account: pick.cs.account,
                displayName: pick.cs.displayName,
                repository: pick.cs.repository,
                state: pick.cs.state
            }
        };
    }

    // Register Webview View Provider for the sidebar container
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'antigravity-codespaces-view',
            sidebarProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Auth changes fan out to every surface. The sidebar subscribes internally;
    // without this the dashboard and status bar stay stale after login/logout.
    context.subscriptions.push(
        authManager.onAuthChanged(async () => {
            try { await dashboardProvider.refreshHtml(); } catch {}
            try { await statusBar.update(); } catch {}
        })
    );

    // ── Settings Change Listener (fixes BUG-11) ──────────────────────────────
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravity-codespaces.showStatusBarItem')) {
                statusBar.updateVisibility();
            }
            if (e.affectsConfiguration('antigravity-codespaces.serverAliveInterval') ||
                e.affectsConfiguration('antigravity-codespaces.serverAliveCountMax')) {
                sidebarProvider.refresh();
            }
        })
    );

    // ── Command: Open Dashboard ──────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.openDashboard', async () => {
            await dashboardProvider.openOrReveal();
        })
    );

    // ── Command: Quick Connect (Alt+C) ───────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.quickConnect', async () => {
            const accounts = await authManager.getAccounts();
            if (!accounts.length) {
                const act = await vscode.window.showWarningMessage('No GitHub accounts found.', 'Sign In');
                if (act === 'Sign In') await authManager.login();
                return;
            }

                await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'Fetching Codespaces...' },
                async () => {
                    // Fetch all accounts in parallel instead of serially.
                    const settled = await Promise.all(accounts.map(async (acc) => {
                        try {
                            const list = await githubApi.listCodespaces(acc.account);
                            return list.map(c => ({ ...c, account: acc.account }));
                        } catch {
                            return [];
                        }
                    }));
                    const allCs = settled.flat();

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
                            detail: `Branch: ${cs.gitStatus?.ref || '—'} | Last active: ${formatRelativeTime(cs.lastUsedAt)}`,
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

    // ── Command: Quick Actions Menu ──────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.quickMenu', async () => {
            const accounts = await authManager.getAccounts();
            const active = authManager.getActiveAccount() || 'None';

            // Show login option when not authenticated (fixes BUG-14)
            if (accounts.length === 0) {
                const loginPick = await vscode.window.showQuickPick([
                    { label: '$(key) Sign In with GitHub', action: 'login', description: 'Authenticate to manage your Codespaces' },
                    { label: '$(shield) Use Personal Access Token (PAT)', action: 'loginPat', description: 'Connect using a GitHub token' }
                ], { placeHolder: 'Antigravity Codespaces — Authentication Required' });

                if (loginPick?.action === 'login') await authManager.login();
                if (loginPick?.action === 'loginPat') await authManager.loginWithPat();
                return;
            }

            const picks = [
                { label: '$(play) Quick Connect to Codespace...', action: 'quickConnect', description: 'Alt+C — Connect in 1 click' },
                { label: '$(layout-sidebar-left) Open Cloud Hub Dashboard', action: 'dashboard', description: 'Full Bento management board' },
                { label: '$(account) Switch Active GitHub Account', action: 'switchAccount', description: `Currently active: ${active}` },
                { label: '$(plus) Create New Codespace...', action: 'create', description: 'Pick repository and launch' },
                { label: '$(cloud-upload) Sync SSH Config', action: 'syncSSH', description: 'Write ProxyCommand entries to ~/.ssh/config' },
                { label: '$(zap) Test SSH Connectivity', action: 'testSSH', description: 'Verify latency and tunnel health' },
                { label: '$(refresh) Refresh All Statuses', action: 'refresh', description: 'Query latest container states' }
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

    // ── Command: Test SSH Tunnel ─────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.testSSH', async (item) => {
            let cs = item?.codespaceData;
            if (!cs) {
                const accounts = await authManager.getAccounts();
                const settled = await Promise.all(accounts.map(async (acc) => {
                    try {
                        const list = await githubApi.listCodespaces(acc.account);
                        return list.map(c => ({ ...c, account: acc.account }));
                    } catch {
                        return [];
                    }
                }));
                const all = settled.flat();
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
                { location: vscode.ProgressLocation.Notification, title: `Testing SSH tunnel to ${cs.displayName || cs.name}...`, cancellable: false },
                async () => {
                    try {
                        const token = await authManager.getToken(cs.account);
                        const latency = await testSshTunnel(cs.name, token);
                        vscode.window.showInformationMessage(`✅ SSH tunnel to "${cs.displayName || cs.name}" is healthy! Latency: ${latency}ms`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`SSH test failed for ${cs.displayName || cs.name}: ${friendlyError(e)}`);
                    }
                }
            );
        })
    );

    // ── Command: Refresh ─────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.refresh', async () => {
            authManager.clearCache();
            githubApi.clearCache();
            await sidebarProvider.refresh();
            await dashboardProvider.refreshHtml();
            await statusBar.update();
            vscode.window.showInformationMessage('Codespaces refreshed.');
        })
    );

    // ── Command: Switch Account ──────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.switchAccount', async (target) => {
            const accName = typeof target === 'string' ? target : target?.account;
            if (accName) {
                authManager.setActiveAccount(accName);
                await sidebarProvider.refresh();
                await dashboardProvider.refreshHtml();
                await statusBar.update();
                vscode.window.showInformationMessage(`Switched active account to: ${accName}`);
                return;
            }

            const accounts = await authManager.getAccounts();
            const picks = [
                ...accounts.map(a => ({
                    label: `$(person) ${a.account}`,
                    acc: a.account,
                    description: a.account === authManager.getActiveAccount() ? '(Active)' : `(${a.type})`
                })),
                { label: '$(key) Sign In with another GitHub Account', isAdd: true },
                { label: '$(shield) Add Personal Access Token (PAT)', isPat: true }
            ];
            const sel = await vscode.window.showQuickPick(picks, { placeHolder: 'Switch GitHub account' });
            if (!sel) return;

            if (sel.isAdd) {
                await authManager.login();
                return;
            }
            if (sel.isPat) {
                await authManager.loginWithPat();
                return;
            }

            authManager.setActiveAccount(sel.acc);
            await sidebarProvider.refresh();
            await dashboardProvider.refreshHtml();
            await statusBar.update();
            vscode.window.showInformationMessage(`Switched active account to: ${sel.acc}`);
        })
    );

    // ── Command: Create Codespace ────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.createCodespace', async () => {
            const accounts = await authManager.getAccounts();
            if (!accounts.length) {
                const act = await vscode.window.showWarningMessage('Please sign in first.', 'Sign In');
                if (act === 'Sign In') await authManager.login();
                return;
            }

            const accPick = await vscode.window.showQuickPick(
                accounts.map(a => ({
                    label: `$(person) ${a.account}`,
                    acc: a.account,
                    description: a.account === authManager.getActiveAccount() ? '(Active)' : ''
                })),
                { placeHolder: 'Select GitHub account for new Codespace' }
            );
            if (!accPick) return;

            // Guard: without an API token for the chosen account, creation falls
            // back to the gh CLI — which would silently create under the CLI's
            // active user instead. Confirm before that can surprise anyone.
            try {
                const token = await authManager.getToken(accPick.acc);
                if (!token) {
                    const ghUser = await getGhActiveUser();
                    if (ghUser && ghUser.toLowerCase() !== String(accPick.acc).toLowerCase()) {
                        const go = await vscode.window.showWarningMessage(
                            `No API token for "${accPick.acc}" — creation would fall back to gh CLI as "${ghUser}" (wrong account).`,
                            'Continue Anyway',
                            'Cancel'
                        );
                        if (go !== 'Continue Anyway') return;
                    }
                }
            } catch {}

            vscode.window.showInformationMessage(`Loading repositories for ${accPick.acc}...`);
            const repos = await githubApi.fetchUserRepos(accPick.acc);

            let repoValue;
            const validateRepoInput = (v) => {
                const val = (v || '').trim();
                if (!val) return null; // empty = cancel path handled by caller
                const norm = GithubApi.normalizeRepoInput(val);
                return (norm.owner && norm.repoName) ? null : 'Enter a repository in owner/repo format (e.g. octocat/Hello-World)';
            };
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
                    repoValue = await vscode.window.showInputBox({ prompt: 'Enter owner/repo', placeHolder: 'owner/repo-name', validateInput: validateRepoInput });
                } else {
                    repoValue = repoPick.val;
                }
            } else {
                repoValue = await vscode.window.showInputBox({ prompt: 'Enter owner/repo', placeHolder: 'owner/repo-name', validateInput: validateRepoInput });
            }
            if (!repoValue) return;

            const branch = await vscode.window.showInputBox({ prompt: 'Branch name (leave empty for default)', placeHolder: 'main' });

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Creating Codespace on ${repoValue}...`, cancellable: false },
                async () => {
                    try {
                        const newName = await githubApi.createCodespace(repoValue, branch || '', accPick.acc);
                        vscode.window.showInformationMessage(`Created Codespace: ${newName}`);
                        sidebarProvider.refresh();
                        dashboardProvider.refreshHtml();
                        statusBar.update();
                    } catch (e) {
                        vscode.window.showErrorMessage(`Create failed: ${friendlyError(e)}`);
                    }
                }
            );
        })
    );

    // ── Command: Connect ─────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.connect', async (item) => {
            let cs = item?.codespaceData;
            if (!cs) {
                // Palette invocation without context → offer the Quick Connect flow.
                await vscode.commands.executeCommand('antigravity-codespaces.quickConnect');
                return;
            }

            if (connectingSet.has(cs.name)) {
                vscode.window.showInformationMessage(`Already connecting to ${cs.displayName || cs.name}...`);
                return;
            }
            connectingSet.add(cs.name);

            const account = cs.account || authManager.getActiveAccount();

            try {
                // Preflight: `gh cs ssh` authenticates as the CLI's ACTIVE user, not
                // as our per-account token. A mismatch means GitHub answers 404 and
                // the tunnel dies with exit 255 — catch it here with a fix action
                // instead of a cryptic SSH failure. Fails open (proceeds on any doubt).
                if (account) {
                    const ghUser = await getGhActiveUser();
                    if (ghUser && ghUser.toLowerCase() !== String(account).toLowerCase()) {
                        const act = await vscode.window.showWarningMessage(
                            `gh CLI is signed in as "${ghUser}", but "${cs.displayName || cs.name}" belongs to "${account}". SSH would fail (Codespace not found for ${ghUser}).`,
                            'Switch gh CLI & Retry',
                            'Connect Anyway'
                        );
                        if (act === 'Switch gh CLI & Retry') {
                            try {
                                const ghExe = findGhExecutable();
                                await runCommand(ghExe, ['auth', 'switch', '--hostname', 'github.com', '--user', account], 15000);
                                vscode.window.showInformationMessage(`gh CLI switched to ${account}. Retrying…`);
                            } catch (swErr) {
                                const t = vscode.window.createTerminal('gh auth switch');
                                t.show();
                                t.sendText(`gh auth switch --hostname github.com --user ${account}`);
                                vscode.window.showWarningMessage(`Automatic switch failed (${friendlyError(swErr)}). Run the command in the terminal, then retry Connect.`);
                                return;
                            }
                        } else if (act !== 'Connect Anyway') {
                            return;
                        }
                    }
                }

                const hostAlias = ensureSSHConfigEntry(cs, account);
                const repoShort = ((cs.repository || cs.name).split('/').pop() || 'workspace').replace(/[^a-zA-Z0-9_-]/g, '-');
                const config = vscode.workspace.getConfiguration('antigravity-codespaces');
                const folderTemplate = config.get('defaultRemoteFolder', '/workspaces/${repo}');
                const remoteFolder = folderTemplate
                    .replace(/\${repo}/g, repoShort)
                    .replace(/\${name}/g, cs.name);

                // Fast REST wake-up if container is not available (fixes BUG-10)
                if (cs.state !== 'Available') {
                    await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: `Waking up ${cs.displayName || cs.name}...`, cancellable: false },
                        async () => {
                            await githubApi.startCodespace(cs.name, account);
                        }
                    );
                }

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Connecting to ${cs.displayName || cs.name}...`, cancellable: false },
                    async (progress) => {
                        progress.report({ message: 'Opening remote workspace in Antigravity...' });
                        let connected = false;

                        // Tier 1: Direct URI resolution
                        try {
                            await vscode.commands.executeCommand('vscode.openFolder',
                                vscode.Uri.from({ scheme: 'vscode-remote', authority: `ssh-remote+${hostAlias}`, path: remoteFolder }),
                                { forceNewWindow: true }
                            );
                            connected = true;
                        } catch {}

                        // Tier 2: Remote SSH extension commands
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

                        // Tier 3: Binary CLI launcher (execFile argv — no shell
                        // interpolation). Only attempted when the launcher binary
                        // actually exists, so Tier 4 terminal fallback still runs
                        // when it does not.
                        let launcherExists = false;
                        try { launcherExists = !!ANTIGRAVITY_EXE && fs.existsSync(ANTIGRAVITY_EXE); } catch {}
                        if (!connected && launcherExists) {
                            try {
                                const child = execFile(ANTIGRAVITY_EXE,
                                    ['--folder-uri', `vscode-remote://ssh-remote+${hostAlias}${remoteFolder}`],
                                    { windowsHide: true },
                                    () => {});
                                child.on('error', () => {});
                                child.unref?.();
                                connected = true;
                            } catch {}
                        }

                        // Tier 4: Integrated Terminal SSH fallback
                        if (!connected) {
                            const diag = await SystemDoctor.diagnose(authManager);
                            if (!diag.ghInstalled) {
                                await SystemDoctor.promptInstallGhCli();
                            } else {
                                const t = vscode.window.createTerminal(`SSH: ${cs.displayName || cs.name}`);
                                t.show();
                                t.sendText(`gh cs ssh -c ${cs.name}`);
                            }
                        }

                        sidebarProvider.refresh();
                        dashboardProvider.refreshHtml();
                        statusBar.update();
                    }
                );
            } catch (err) {
                vscode.window.showErrorMessage(`Connection error: ${friendlyError(err)}`);
            } finally {
                connectingSet.delete(cs.name);
            }
        })
    );

    // ── Command: Start ───────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.start', async (item) => {
            if (!item?.codespaceData) item = await pickCodespace('Select a Codespace to turn ON');
            const cs = item?.codespaceData;
            if (!cs) return;
            if (cs.state === 'Available') {
                vscode.window.showInformationMessage(`${cs.displayName || cs.name} is already running.`);
                return;
            }
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Waking up ${cs.displayName || cs.name}...`, cancellable: false },
                async () => {
                    try {
                        await githubApi.startCodespace(cs.name, cs.account);
                        vscode.window.showInformationMessage(`${cs.displayName || cs.name} is starting!`);
                        sidebarProvider.refresh();
                        dashboardProvider.refreshHtml();
                        statusBar.update();
                    } catch (e) {
                        vscode.window.showErrorMessage(`Could not start: ${friendlyError(e)}`);
                    }
                }
            );
        })
    );

    // ── Command: Stop ────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.stop', async (item) => {
            if (!item?.codespaceData) item = await pickCodespace('Select a Codespace to stop');
            const cs = item?.codespaceData;
            if (!cs) return;
            try {
                await githubApi.stopCodespace(cs.name, cs.account);
                vscode.window.showInformationMessage(`Stopped ${cs.displayName || cs.name}.`);
                sidebarProvider.refresh();
                dashboardProvider.refreshHtml();
                statusBar.update();
            } catch (e) {
                vscode.window.showErrorMessage(`Stop failed: ${friendlyError(e)}`);
            }
        })
    );

    // ── Command: Rebuild ─────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.rebuild', async (item) => {
            if (!item?.codespaceData) item = await pickCodespace('Select a Codespace to rebuild');
            const cs = item?.codespaceData;
            if (!cs) return;

            let isFull = item?.full;
            if (isFull === undefined) {
                const mode = await vscode.window.showQuickPick([
                    { label: '$(debug-start) Standard Rebuild', desc: 'Uses layer cache', full: false },
                    { label: '$(symbol-event) Full Rebuild (no cache)', desc: 'Clean container rebuild', full: true }
                ], { placeHolder: `Rebuild ${cs.displayName || cs.name}?` });
                if (!mode) return;
                isFull = mode.full;
            }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Rebuilding ${cs.displayName || cs.name}...`, cancellable: false },
                async () => {
                    try {
                        await githubApi.rebuildCodespace(cs.name, cs.account, isFull);
                        vscode.window.showInformationMessage(`Rebuild started for ${cs.displayName || cs.name}.`);
                        sidebarProvider.refresh();
                        dashboardProvider.refreshHtml();
                        statusBar.update();
                    } catch (e) {
                        vscode.window.showErrorMessage(`Rebuild failed: ${friendlyError(e)}`);
                    }
                }
            );
        })
    );

    // ── Command: Delete ──────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.deleteCodespace', async (item) => {
            if (!item?.codespaceData) item = await pickCodespace('Select a Codespace to delete');
            const cs = item?.codespaceData;
            if (!cs) return;

            if (!item?.confirmed) {
                const ok = await vscode.window.showWarningMessage(
                    `Delete "${cs.displayName || cs.name}"? This is permanent.`,
                    { modal: true },
                    'Delete'
                );
                if (ok !== 'Delete') return;
            }

            try {
                await githubApi.deleteCodespace(cs.name, cs.account);
                vscode.window.showInformationMessage(`Deleted ${cs.displayName || cs.name}.`);
                sidebarProvider.refresh();
                dashboardProvider.refreshHtml();
                statusBar.update();
            } catch (e) {
                vscode.window.showErrorMessage(`Delete failed: ${friendlyError(e)}`);
            }
        })
    );

    // ── Command: Copy SSH ────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.copySSHCommand', async (item) => {
            if (!item?.codespaceData) item = await pickCodespace('Select a Codespace to copy the SSH command for');
            const cs = item?.codespaceData;
            if (!cs) return;
            const cmd = `gh cs ssh -c ${cs.name}`;
            vscode.env.clipboard.writeText(cmd);
            vscode.window.showInformationMessage(`Copied: ${cmd}`);
        })
    );

    // ── Command: Open in Browser ─────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.openInBrowser', async (item) => {
            if (!item?.codespaceData) item = await pickCodespace('Select a Codespace to open in the browser');
            const cs = item?.codespaceData;
            if (!cs) return;
            vscode.env.openExternal(vscode.Uri.parse(`https://github.com/codespaces/${cs.name}`));
        })
    );

    // ── Command: Open Port URL ───────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.openPortUrl', (url) => {
            if (url) vscode.env.openExternal(vscode.Uri.parse(url));
        })
    );

    // ── Command: Login to GitHub (Native OAuth, fixes BUG-01) ────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.loginGitHub', async () => {
            await authManager.login();
        })
    );

    // ── Command: Sync All SSH Configs ────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-codespaces.syncAllSSH', async () => {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Syncing all Codespaces to ~/.ssh/config...', cancellable: false },
                async () => {
                    // First purge stale pre-v5.0.1 artifacts (unmarked legacy blocks,
                    // phantom codespaces.auto keys) that would otherwise shadow the
                    // fresh entries OpenSSH resolves first-match-wins.
                    const cleaned = cleanSshConfigFile();
                    const accounts = await authManager.getAccounts();
                    let n = 0;
                    await Promise.all(accounts.map(async (acc) => {
                        try {
                            const list = await githubApi.listCodespaces(acc.account);
                            list.forEach(cs => { ensureSSHConfigEntry(cs, acc.account); n++; });
                        } catch {}
                    }));
                    vscode.window.showInformationMessage(
                        `Synced ${n} Codespace SSH entries to ~/.ssh/config` +
                        ((cleaned.removedBlocks || cleaned.removedKeys)
                            ? ` (cleaned ${cleaned.removedBlocks || 0} stale blocks, ${cleaned.removedKeys || 0} phantom keys)`
                            : '')
                    );
                    sidebarProvider.refresh();
                    dashboardProvider.refreshHtml();
                    statusBar.update();
                }
            );
        })
    );

    // ── Startup Auto-Sync & Status Bar Init ───────────────────────────────────
    const startupCfg = vscode.workspace.getConfiguration('antigravity-codespaces');
    if (startupCfg.get('autoSyncSSHOnStartup', true)) {
        setTimeout(async () => {
            try {
                cleanSshConfigFile();
                const accounts = await authManager.getAccounts();
                await Promise.all(accounts.map(async (acc) => {
                    try {
                        const list = await githubApi.listCodespaces(acc.account);
                        list.forEach(cs => ensureSSHConfigEntry(cs, acc.account));
                    } catch {}
                }));
                await statusBar.update();
            } catch {}
        }, 2000);
    } else {
        statusBar.update();
    }
}

/**
 * Extension deactivation cleanup (fixes BUG-12).
 */
function deactivate() {
    connectingSet.clear();
    if (globalAuthManager) globalAuthManager.clearCache();
    if (globalGithubApi) globalGithubApi.clearCache();
}

module.exports = { activate, deactivate };
