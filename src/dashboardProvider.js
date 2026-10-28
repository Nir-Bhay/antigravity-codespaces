const vscode = require('vscode');
const { escapeHtml, generateNonce, formatRelativeTime, I } = require('./utils');
const { testSshTunnel } = require('./sshManager');
const errorUx = require('./errorUx');
const EXT_VERSION = (() => { try { return require('../package.json').version; } catch (e) { return ''; } })();
const logger = require('./logger');
const { hubUsageCardHtml, hubUsagePageHtml, hubUsageScript, storageTierText, HUB_CSS } = require('./usageView');
const { classifyCodespaceState, createConfirmationText } = require('./codespaceLifecycle');

class DashboardProvider {
    constructor(context, authManager, githubApi, usageService = null) {
        this._context = context;
        this._usageService = usageService;
        this._usage = null;
        this._lastGood = new Map(); // account -> { codespaces, at } for "as of <time>" when a refresh fails
        this._initialPage = null;
        this._usagePeriod = null;
        if (usageService) usageService.onDidChange(() => { if (this._panel) this.refreshHtml(); });
        this._authManager = authManager;
        this._githubApi = githubApi;
        this._panel = null;
    }

    async openOrReveal(page) {
        this._initialPage = page === 'usage' ? 'usage' : null;
        if (this._panel && this._initialPage) {
            this._panel.reveal();
            this._panel.webview.postMessage({ command: 'showUsage' });
            return;
        }
        if (!this._panel) {
            this._panel = vscode.window.createWebviewPanel(
                'csHub',
                'Codespaces Cloud Hub',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [this._context.extensionUri]
                }
            );

            this._panel.onDidDispose(() => {
                this._panel = null;
            });

            this._panel.webview.onDidReceiveMessage(async (msg) => {
                try {
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
                                codespaceData: { name: msg.name, account: msg.account },
                                full: !!msg.full
                            });
                            // No optimistic toast: the host command reports the real
                            // outcome; refresh the grid once the rebuild registers.
                            setTimeout(() => this.refreshHtml(), 3000);
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
                                codespaceData: { name: msg.name, account: msg.account, displayName: msg.displayName, state: msg.state, repository: msg.repo },
                                confirmed: true
                            });
                            setTimeout(() => this.refreshHtml(), 1500);
                            break;
                        case 'testSSH':
                            try {
                                const token = await this._authManager.getToken(msg.account);
                                const latency = await testSshTunnel(msg.name, token);
                                this._panel?.webview.postMessage({
                                    command: 'toast',
                                    text: `SSH tunnel healthy · ${latency} ms`
                                });
                            } catch (e) {
                                this._panel?.webview.postMessage({
                                    command: 'toast',
                                    text: `SSH test failed: ${e.message || 'tunnel unreachable'}`
                                });
                            }
                            break;
                        case 'syncAllSSH':
                            await vscode.commands.executeCommand('antigravity-codespaces.syncAllSSH');
                            this._panel?.webview.postMessage({
                                command: 'toast',
                                text: 'SSH config synced'
                            });
                            break;
                        case 'usageGrant':
                            await vscode.commands.executeCommand('antigravity-codespaces.usageGrantAccess', msg.account);
                            break;
                        case 'usageMonth': {
                            const y = Number(msg.year), m = Number(msg.month);
                            this._usagePeriod = (y > 2000 && m >= 1 && m <= 12) ? { year: y, month: m } : null;
                            this._initialPage = 'usage';
                            await this.refreshHtml();
                            break;
                        }
                        case 'usageOpenUrl': {
                            // Only GitHub-owned destinations.
                            const url = String(msg.url || '');
                            if (/^https:\/\/(github\.com|docs\.github\.com)\//.test(url)) await vscode.env.openExternal(vscode.Uri.parse(url));
                            break;
                        }
                        case 'uxAction':
                            await this._uxAction(String(msg.action || ''));
                            break;
                        case 'usageExport':
                            await this._exportUsage(msg.format === 'json' ? 'json' : 'csv');
                            break;
                        case 'usageRefresh':
                            if (this._usageService) await this._usageService.refresh();
                            else await this.refreshHtml();
                            break;
                        case 'refresh':
                            await this.refreshHtml();
                            this._panel?.webview.postMessage({
                                command: 'toast',
                                text: 'Cloud Hub refreshed'
                            });
                            break;
                        case 'switchAccount': {
                            // Accept a bare account string, { account }, or nothing
                            // (nothing falls through to the host QuickPick by design).
                            const target = typeof msg.account === 'string'
                                ? msg.account
                                : (msg.account && msg.account.account) || undefined;
                            await vscode.commands.executeCommand('antigravity-codespaces.switchAccount', target);
                            break;
                        }
                        case 'loginGitHub':
                            await vscode.commands.executeCommand('antigravity-codespaces.loginGitHub');
                            break;
                        case 'openSettings':
                            vscode.commands.executeCommand('workbench.action.openSettings', '@ext:antigravity-codespaces');
                            break;
                        case 'fetchRepos': {
                            const account = msg.account || this._authManager.getActiveAccount();
                            try {
                                const repos = await this._githubApi.fetchUserRepos(account);
                                this._panel?.webview.postMessage({
                                    command: 'reposLoaded',
                                    repos: repos || []
                                });
                            } catch (err) {
                                this._panel?.webview.postMessage({
                                    command: 'reposError',
                                    error: err.message || 'Could not load repositories'
                                });
                            }
                            break;
                        }
                        case 'submitCreate': {
                            try {
                                if (!msg.repo || !String(msg.repo).trim()) {
                                    throw new Error('Select a repository first.');
                                }
                                const account = msg.account || this._authManager.getActiveAccount();
                                const branch = msg.branch || '';
                                const approved = await vscode.window.showWarningMessage(
                                    createConfirmationText({ account, repository: msg.repo, branch }),
                                    { modal: true },
                                    'Create Codespace'
                                );
                                if (approved !== 'Create Codespace') {
                                    this._panel?.webview.postMessage({ command: 'createError', error: 'Creation cancelled. No Codespace was created.' });
                                    break;
                                }
                                const newName = await this._githubApi.createCodespace(msg.repo, branch, account);
                                this._panel?.webview.postMessage({
                                    command: 'createSuccess',
                                    name: newName
                                });
                                setTimeout(() => this.refreshHtml(), 2500);
                            } catch (err) {
                                this._panel?.webview.postMessage({
                                    command: 'createError',
                                    error: err.message || 'Creation failed'
                                });
                            }
                            break;
                        }
                        default:
                            console.warn(`DashboardProvider: unknown webview command "${msg && msg.command}" — ignored.`);
                            break;
                    }
                } catch (err) {
                    console.error('DashboardProvider onDidReceiveMessage error:', err);
                }
            });
        } else {
            this._panel.reveal(vscode.ViewColumn.One);
        }

        await this.refreshHtml();
    }

    async _uxAction(action) {
        switch (action) {
            case 'retry': if (this._githubApi && this._githubApi.clearCache) this._githubApi.clearCache(); await this.refreshHtml(); break;
            case 'githubStatus': await vscode.env.openExternal(vscode.Uri.parse(errorUx.GITHUB_STATUS_URL)); break;
            case 'signIn': case 'grantScope': await vscode.commands.executeCommand('antigravity-codespaces.loginGitHub'); break;
            case 'setupDoctor': await vscode.commands.executeCommand('antigravity-codespaces.setupDoctor'); break;
            case 'details': logger.show(); break;
            default: break;
        }
    }

    async _exportUsage(format) {
        const u = this._usage;
        if (!u || u.mode !== 'live') { vscode.window.showWarningMessage('No usage data to export.'); return; }
        const { toCsv, toJson } = require('./usageService');
        const name = `codespaces-usage-${u.login}-${u.period.year}-${String(u.period.month).padStart(2, '0')}.${format}`;
        const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(require('path').join(require('os').homedir(), name)), filters: format === 'csv' ? { CSV: ['csv'] } : { JSON: ['json'] } });
        if (!target) return;
        await vscode.workspace.fs.writeFile(target, Buffer.from(format === 'csv' ? toCsv(u) : toJson(u), 'utf8'));
        vscode.window.showInformationMessage(`Exported usage to ${target.fsPath}`);
    }

    async refreshHtml() {
        if (!this._panel) return;
        try {
            const nonce = generateNonce();
            // Instant loading state so the panel is never blank during fetches.
            this._panel.webview.html = `<!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
              <style nonce="${nonce}">
                body { background: var(--vscode-editor-background, #f8fafc); color: var(--vscode-editor-foreground, #0f172a); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .hub-loading { text-align: center; font-size: 13px; opacity: 0.8; }
                .hub-spinner { width: 28px; height: 28px; margin: 0 auto 12px; border-radius: 50%; border: 3px solid rgba(127,127,127,0.3); border-top-color: #0b75f0; animation: hubspin 0.9s linear infinite; }
                @keyframes hubspin { to { transform: rotate(360deg); } }
                body.skel { display:block; height:auto; padding: 24px; }
                ${errorUx.UX_CSS}
              </style>
            </head>
            <body class="skel">
              ${errorUx.skeletonHtml(3)}
            </body>
            </html>`;

            const accounts = await this._authManager.getAccounts();
            const activeAccount = this._authManager.getActiveAccount();

            if (accounts.length === 0) {
                this._panel.webview.html = this.buildDashboardHtml([], activeAccount, []);
                return;
            }

            // Fetch all accounts in parallel instead of serially.
            const all = await Promise.all(accounts.map(async (acc) => {
                try {
                    const list = await this._githubApi.listCodespaces(acc.account);
                    this._lastGood.set(acc.account, { codespaces: list || [], at: Date.now() });
                    return { account: acc.account, type: acc.type, codespaces: list || [] };
                } catch (e) {
                    logger.warn(`Cloud Hub: list for ${acc.account} failed`, e && e.message);
                    // Error banner over the last cached data, marked "as of <time>".
                    const prev = this._lastGood.get(acc.account);
                    return { account: acc.account, type: acc.type, codespaces: prev ? prev.codespaces : [], error: e.message, errorKind: e.kind, errorStatus: e.status, cachedAt: prev ? prev.at : null };
                }
            }));

            this._usage = null;
            if (this._usageService) {
                // Usage is always for the active gh account, independent of the selected account chip.
                this._usage = await Promise.race([
                    this._usageService.getActiveUsage(this._usagePeriod || undefined),
                    new Promise(r => setTimeout(() => r(null), 10000))
                ]).catch(() => null);
                this._usageOpts = this._usageService.viewOptions ? this._usageService.viewOptions() : {};
                // The compact card always shows the current month, even when the Usage page shows another one.
                this._usageCard = this._usagePeriod ? await this._usageService.getActiveUsage().catch(() => null) : null;
            }
            this._panel.webview.html = this.buildDashboardHtml(all, activeAccount, accounts);
            if (this._initialPage === 'usage') this._initialPage = null;
        } catch (err) {
            const nonce = generateNonce();
            this._panel.webview.html = `<!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
              <style nonce="${nonce}">
                body { background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .err-card { background: #fff; border: 1px solid #dce3ec; border-radius: 12px; padding: 32px; max-width: 480px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
                .err-title { font-size: 18px; font-weight: 700; color: #dc2626; margin-bottom: 8px; }
                .err-msg { font-size: 13px; color: #64748b; margin-bottom: 20px; word-break: break-word; }
                .btn-retry { background: #0b75f0; color: #fff; border: none; padding: 8px 18px; border-radius: 8px; font-weight: 600; cursor: pointer; }
              </style>
            </head>
            <body>
              <div class="err-card">
                <div class="err-title">Failed to load Cloud Hub</div>
                <div class="err-msg">${escapeHtml(err.message)}</div>
                <button class="btn-retry" id="btnErrRetry">Retry</button>
              </div>
              <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                document.getElementById('btnErrRetry').addEventListener('click', () => vscode.postMessage({command:'refresh'}));
              </script>
            </body>
            </html>`;
        }
    }

    /** Banners for accounts whose list failed. Pure (tested). */
    static accountErrorBanners(accountErrors, multi = false) {
        return accountErrors.map(({ account, error, errorKind, errorStatus, cachedAt }) => {
            const e = new Error(error); e.kind = errorKind; e.status = errorStatus;
            const c = errorUx.classifyError(e);
            // Offline with cached data is a warning; failures with nothing to show stay critical.
            if (c.kind === 'network' && !cachedAt) c.level = 'critical';
            if (multi) c.title = `${account}: ${c.title}`;
            const asOf = cachedAt ? new Date(cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            return errorUx.bannerHtml(c, { asOf, account });
        }).join('');
    }

    /** Amber Cloud Hub banner for usage: cached/offline data, missing scope, or near the quota. Pure (tested). */
    static usageBanner(u, thresholds = [75, 90]) {
        if (!u) return '';
        if (u.offline) return errorUx.bannerHtml({ kind: 'usageOffline', level: 'warning', title: 'Usage is from the last successful refresh.', why: "Couldn't reach GitHub billing.", actions: ['retry'] }, { asOf: new Date(u.lastUpdated || u.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        if (u.mode === 'needsPermission') return errorUx.bannerHtml({ kind: 'scope', level: 'warning', title: 'Usage needs one more GitHub permission.', why: 'The billing API needs the "user" scope.', actions: ['grantScope'] });
        if (u.mode !== 'live' || u.isCurrent === false) return '';
        const t = Math.min(...(Array.isArray(thresholds) && thresholds.length ? thresholds : [75]).map(Number).filter(x => x > 0));
        const parts = [];
        if (u.compute && u.compute.quota > 0 && (u.compute.used / u.compute.quota) * 100 >= t) parts.push(`compute ${Math.round((u.compute.used / u.compute.quota) * 100)}% (${u.compute.used} / ${u.compute.quota} core-hrs)`);
        if (u.storage && u.storage.quota > 0 && u.storage.used != null && (u.storage.used / u.storage.quota) * 100 >= t) parts.push(`storage ${Math.round((u.storage.used / u.storage.quota) * 100)}% (${u.storage.used} / ${u.storage.quota} GB-month)`);
        if (!parts.length) return '';
        return errorUx.bannerHtml({ kind: 'nearQuota', level: 'warning', title: 'Close to your included Codespaces quota.', why: `Used: ${parts.join(', ')}. Usage beyond the quota is billed.`, actions: ['openUsage'] });
    }

    buildDashboardHtml(accountsData, activeAccount, accountsList) {
        let total = 0, online = 0, offline = 0, otherStates = 0;
        const flat = [];
        const accountErrors = [];

        accountsData.forEach(({ account, type, codespaces, error, errorKind, errorStatus, cachedAt }) => {
            if (error) {
                accountErrors.push({ account, error: String(error).slice(0, 300), errorKind, errorStatus, cachedAt });
            }
            (codespaces || []).forEach(cs => {
                total++;
                const state = classifyCodespaceState(cs.state);
                if (state.kind === 'running') online++;
                else if (state.kind === 'stopped') offline++;
                else otherStates++;
                flat.push({ ...cs, account, authType: type });
            });
        });

        flat.sort((a, b) => {
            if (a.state === 'Available' && b.state !== 'Available') return -1;
            if (b.state === 'Available' && a.state !== 'Available') return 1;
            const ta = new Date(b.lastUsedAt || 0).getTime();
            const tb = new Date(a.lastUsedAt || 0).getTime();
            if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
            return 0;
        });

        // Logged-out (or fully undiscoverable) state: no accounts at all.
        const isLoggedOut = !accountsList || accountsList.length === 0;

        const cachedAccounts = new Set(accountErrors.filter(e => e.cachedAt).map(e => e.account));
        const accountErrorsHtml = DashboardProvider.accountErrorBanners(accountErrors, accountsList && accountsList.length > 1);

        const nonce = generateNonce();

        // Account initial / color mapping
        const avatarColors = ['#8b5cf6', '#334155', '#16a34a', '#0284c7', '#d97706', '#db2777'];
        const getAccountColor = (name) => {
            let hash = 0;
            for (let i = 0; i < (name || '').length; i++) {
                hash = (hash << 5) - hash + name.charCodeAt(i);
                hash |= 0;
            }
            return avatarColors[Math.abs(hash) % avatarColors.length];
        };

        const getInitials = (name) => {
            if (!name) return 'GH';
            const clean = name.replace(/[^a-zA-Z0-9]/g, '');
            if (clean.length >= 2) return clean.slice(0, 2).toUpperCase();
            return (clean[0] || 'U').toUpperCase();
        };

        // Render Account Chips
        const accountChipsHtml = accountsData.map(({ account, codespaces }, idx) => {
            const count = (codespaces || []).length;
            const initials = getInitials(account);
            const color = avatarColors[idx % avatarColors.length];
            return `
            <button class="account-chip" data-acc="${escapeHtml(account)}">
              <span class="chip-avatar" style="background:${color}; color:#ffffff;">${escapeHtml(initials)}</span>
              <span class="chip-name">${escapeHtml(account)}</span>
              <span class="chip-count">${count}</span>
            </button>`;
        }).join('');

        // Render Workspace Cards for Grid View
        const cardsHtml = flat.map(cs => {
            const state = classifyCodespaceState(cs.state);
            const running = state.kind === 'running';
            const stopped = state.kind === 'stopped';
            const repo = cs.repository || cs.name;
            const branch = cs.gitStatus?.ref || '—';
            const time = formatRelativeTime(cs.lastUsedAt);
            const idleMins = cs.idleTimeoutMinutes || 30;
            const displayName = cs.displayName || cs.name;
            const initials = getInitials(cs.account);
            const accColor = getAccountColor(cs.account);
            const machine = cs.machineDisplayName || cs.machineName || 'Not reported by GitHub';
            const lifecycleDisabled = cachedAccounts.has(cs.account) || !state.actionable;
            const lifecycleDisabledAttr = lifecycleDisabled ? ' disabled aria-disabled="true" title="Refresh GitHub state before using lifecycle actions"' : '';

            return `
            <article class="ws-card is-${state.kind}${cachedAccounts.has(cs.account) ? ' is-cached' : ''}"
                     data-account="${escapeHtml(cs.account)}" 
                     data-name="${escapeHtml(cs.name)}" 
                     data-repo="${escapeHtml(repo)}"
                     data-branch="${escapeHtml(branch)}"
                     data-state="${state.kind}">
              
              <!-- Card Header: Status Dot + Title + 3-Dot Menu -->
              <div class="ws-card-header">
                <div class="ws-title-group">
                  <span class="status-indicator status-${state.kind}" title="GitHub state: ${escapeHtml(state.raw || 'unavailable')}">
                    <span class="status-dot"></span>
                    ${running ? '<span class="status-pulse"></span>' : ''}
                  </span>
                  <h3 class="ws-title" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</h3>${cachedAccounts.has(cs.account) ? '<span class="cached-tag" title="Last known state. Actions are disabled until a refresh succeeds.">Cached</span>' : ''}
                </div>
                <div class="ws-dropdown-wrap">
                  <button class="btn-more" data-cmd="openMenu" title="More options" aria-label="More options">
                    ${I.moreVertical}
                  </button>
                  <div class="ws-card-menu">
                    <button class="menu-item" data-cmd="testSSH" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Test SSH Tunnel Latency">
                      ${I.zap} <span>Test SSH</span>
                    </button>
                    <button class="menu-item" data-cmd="openWeb" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Open in GitHub Web">
                      ${I.globe} <span>Open in GitHub Web</span>
                    </button>
                    <button class="menu-item" data-cmd="openRebuildModal" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}"${lifecycleDisabledAttr}>
                      ${I.build} <span>Rebuild DevContainer</span>
                    </button>
                    <button class="menu-item" data-cmd="copySSH" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Copy SSH Command">
                      ${I.term} <span>Copy SSH Command</span>
                    </button>
                    <div class="menu-divider"></div>
                    <button class="menu-item menu-item-danger" data-cmd="openDeleteModal" data-name="${escapeHtml(cs.name)}" data-display-name="${escapeHtml(displayName)}" data-acc="${escapeHtml(cs.account)}" data-state="${escapeHtml(state.raw)}" data-repo="${escapeHtml(repo)}"${cachedAccounts.has(cs.account) ? ' disabled aria-disabled="true"' : ''} title="${cachedAccounts.has(cs.account) ? 'Disabled until a refresh succeeds' : 'Delete Codespace'}">
                      ${I.trash} <span>Delete Codespace</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Second Line: User Avatar + Name + Status Pill Badge -->
              <div class="ws-user-row">
                <div class="ws-user-info" title="GitHub Account: ${escapeHtml(cs.account)}">
                  <span class="user-avatar-small" style="background:${accColor}; color:#ffffff;">${escapeHtml(initials)}</span>
                  <span class="user-name">${escapeHtml(cs.account)}</span>
                </div>
                <span class="status-badge badge-${state.kind}" title="GitHub state: ${escapeHtml(state.raw || 'unavailable')}">
                  ${escapeHtml(state.label)}
                </span>
              </div>

              <!-- Metadata Rows -->
              <div class="ws-meta-rows">
                <div class="meta-row" title="Repository: ${escapeHtml(repo)}">
                  <span class="meta-icon">${I.repo}</span>
                  <span class="meta-text meta-repo">${escapeHtml(repo)}</span>
                </div>
                <div class="meta-row" title="Branch: ${escapeHtml(branch)}">
                  <span class="meta-icon">${I.branch}</span>
                  <span class="branch-pill"><code>${escapeHtml(branch)}</code></span>
                </div>
                <div class="meta-row meta-row-split">
                  <div class="meta-time-group" title="Last active">
                    <span class="meta-icon">${I.clock}</span>
                    <span class="meta-text">Active ${escapeHtml(time)}</span>
                  </div>
                  ${running ? `
                  <div class="meta-idle-group" title="Auto-stops after ${idleMins}m inactivity">
                    <span class="meta-icon idle-icon">${I.moon}</span>
                    <span class="meta-text idle-text">Idle timeout: ${idleMins}m</span>
                  </div>` : ''}
                </div>
                <div class="meta-row" title="Machine size from GitHub Codespaces">
                  <span class="meta-icon">${I.desktop}</span><span>Machine: ${escapeHtml(machine)}</span>
                </div>
              </div>

              <!-- Action Dock -->
              <div class="ws-action-dock">
                <div class="action-primary-group">
                  ${running ? `
                    <button class="action-btn btn-connect" data-cmd="connect" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" data-repo="${escapeHtml(repo)}"${cachedAccounts.has(cs.account) ? ' disabled aria-disabled="true" title="Disabled until a refresh succeeds"' : ' title="Connect in Antigravity IDE"'}>
                      ${I.play} <span>Connect</span>
                    </button>
                    <button class="action-btn btn-stop" data-cmd="stop" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}"${lifecycleDisabledAttr} title="Stop compute; storage billing continues until deletion">
                      ${I.stop} <span>Stop</span>
                    </button>
                  ` : stopped ? `
                    <button class="action-btn btn-start" data-cmd="start" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}"${lifecycleDisabledAttr} title="Start compute; charges may apply">
                      ${I.play} <span>Start</span>
                    </button>
                  ` : `<span class="lifecycle-state-note" role="status">${escapeHtml(state.label)} · refresh to confirm</span>`}
                </div>

                <div class="action-utility-group">
                  <button class="util-btn" data-cmd="testSSH" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Test SSH Tunnel Latency" aria-label="Test SSH">
                    ${I.zap}
                  </button>
                  ${running ? '' : `<button class="util-btn" data-cmd="openWeb" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Open in GitHub Web" aria-label="Open Web">
                    ${I.globe}
                  </button>
                  <button class="util-btn" data-cmd="openRebuildModal" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}"${lifecycleDisabledAttr} aria-label="Rebuild">
                    ${I.build}
                  </button>
                  `}<button class="util-btn" data-cmd="copySSH" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Copy SSH Command" aria-label="Copy SSH">
                    ${I.term}
                  </button>
                  ${running ? '' : `<button class="util-btn btn-util-delete" data-cmd="openDeleteModal" data-name="${escapeHtml(cs.name)}" data-display-name="${escapeHtml(displayName)}" data-acc="${escapeHtml(cs.account)}" data-state="${escapeHtml(state.raw)}" data-repo="${escapeHtml(repo)}"${cachedAccounts.has(cs.account) ? ' disabled aria-disabled="true" title="Disabled until a refresh succeeds"' : ' title="Delete Codespace"'} aria-label="Delete">
                    ${I.trash}
                  </button>`}
                </div>
              </div>
            </article>`;
        }).join('');

        // Render Workspace Rows for List View
        const tableRowsHtml = flat.map(cs => {
            const state = classifyCodespaceState(cs.state);
            const running = state.kind === 'running';
            const stopped = state.kind === 'stopped';
            const repo = cs.repository || cs.name;
            const branch = cs.gitStatus?.ref || '—';
            const time = formatRelativeTime(cs.lastUsedAt);
            const displayName = cs.displayName || cs.name;
            const machine = cs.machineDisplayName || cs.machineName || 'Not reported by GitHub';
            const disabled = cachedAccounts.has(cs.account) || !state.actionable;
            const disabledAttr = disabled ? ' disabled aria-disabled="true" title="Refresh GitHub state before using lifecycle actions"' : '';

            return `
            <tr class="table-row is-${state.kind}"
                data-account="${escapeHtml(cs.account)}" 
                data-name="${escapeHtml(cs.name)}" 
                data-repo="${escapeHtml(repo)}"
                data-branch="${escapeHtml(branch)}"
                data-state="${state.kind}">
              <td class="col-status">
                <span class="status-indicator status-${state.kind}" title="GitHub state: ${escapeHtml(state.raw || 'unavailable')}">
                  <span class="status-dot"></span>
                </span>
                <span class="status-badge badge-${state.kind}" title="GitHub state: ${escapeHtml(state.raw || 'unavailable')}">${escapeHtml(state.label)}</span>
              </td>
              <td class="col-name">
                <span class="table-ws-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
              </td>
              <td class="col-account">
                <span class="table-acc-pill">${escapeHtml(cs.account)}</span>
              </td>
              <td class="col-repo">
                <span class="table-repo-text" title="${escapeHtml(repo)}">${escapeHtml(repo)}</span>
              </td>
              <td class="col-branch">
                <span class="branch-pill"><code>${escapeHtml(branch)}</code></span>
              </td>
              <td class="col-machine" title="Machine size from GitHub Codespaces">${escapeHtml(machine)}</td>
              <td class="col-time">Active ${escapeHtml(time)}</td>
              <td class="col-actions">
                <div class="table-action-wrap">
                  ${running ? `
                    <button class="action-btn btn-connect btn-sm" data-cmd="connect" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" data-repo="${escapeHtml(repo)}"${cachedAccounts.has(cs.account) ? ' disabled aria-disabled="true" title="Disabled until a refresh succeeds"' : ' title="Connect"'}>
                      ${I.play} <span>Connect</span>
                    </button>
                    <button class="action-btn btn-stop btn-sm" data-cmd="stop" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}"${disabledAttr}>
                      ${I.stop} <span>Stop</span>
                    </button>
                  ` : stopped ? `
                    <button class="action-btn btn-start btn-sm" data-cmd="start" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}"${disabledAttr}>
                      ${I.play} <span>Start</span>
                    </button>
                  ` : `<span class="lifecycle-state-note" role="status">${escapeHtml(state.label)} · refresh</span>`}
                  <button class="util-btn btn-sm" data-cmd="openWeb" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Open Web">${I.globe}</button>
                  <button class="util-btn btn-sm" data-cmd="copySSH" data-name="${escapeHtml(cs.name)}" data-acc="${escapeHtml(cs.account)}" title="Copy SSH">${I.term}</button>
                  <button class="util-btn btn-sm btn-util-delete" data-cmd="openDeleteModal" data-name="${escapeHtml(cs.name)}" data-display-name="${escapeHtml(displayName)}" data-acc="${escapeHtml(cs.account)}" data-state="${escapeHtml(state.raw)}" data-repo="${escapeHtml(repo)}"${cachedAccounts.has(cs.account) ? ' disabled aria-disabled="true" title="Disabled until a refresh succeeds"' : ' title="Delete"'}>${I.trash}</button>
                </div>
              </td>
            </tr>`;
        }).join('');

        // Accounts selection for wizard step 1
        const wizardAccountsHtml = (accountsList || []).map((acc, i) => {
            const isAct = acc.account === activeAccount;
            const initials = getInitials(acc.account);
            const color = avatarColors[i % avatarColors.length];
            return `
            <div class="wizard-acc-row ${isAct ? 'is-active' : ''}" data-acc="${escapeHtml(acc.account)}">
              <div class="acc-row-left">
                <span class="chip-avatar" style="background:${color}; color:#fff;">${escapeHtml(initials)}</span>
                <div class="acc-row-meta">
                  <div class="acc-row-name">
                    ${escapeHtml(acc.account)}
                    ${isAct ? '<span class="pill-active-badge">(Active)</span>' : ''}
                  </div>
                  <div class="acc-row-sub">Signed in via GitHub ${escapeHtml(acc.type || 'OAuth')}</div>
                </div>
              </div>
              <div class="acc-row-radio">
                <input type="radio" name="wizardAccount" value="${escapeHtml(acc.account)}" ${isAct || i === 0 ? 'checked' : ''}>
              </div>
            </div>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src https: data:;">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Antigravity Codespaces Cloud Hub</title>
<style nonce="${nonce}">
/* ── Reset & Typography ─────────────────────────────────────────── */
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono-font: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  /* Approved Design Tokens — Light Theme (Default) */
  --hub-bg-page: #f8fafc;
  --hub-bg-rail: #ffffff;
  --hub-bg-card: #ffffff;
  --hub-border: #dce3ec;
  --hub-border-subtle: #e2e8f0;
  --hub-text-main: #0f172a;
  --hub-text-muted: #64748b;
  --hub-text-subtle: #94a3b8;
  --hub-accent: #0b75f0;
  --hub-accent-hover: #0563d6;
  --hub-accent-soft: #eaf4ff;
  --hub-success: #16a34a;
  --hub-success-soft: #eaf8ef;
  --hub-warning: #d97706;
  --hub-warning-soft: #fff7e6;
  --hub-danger: #ef4444;
  --hub-danger-soft: #fee2e2;
  --hub-danger-text: #dc2626;
  --hub-purple-soft: #f3e8ff;
  --hub-purple-icon: #7c3aed;
  --hub-input-bg: #ffffff;
  --shadow-card: 0 1px 3px rgba(15, 23, 42, 0.05), 0 4px 12px rgba(15, 23, 42, 0.03);
  --shadow-modal: 0 20px 50px rgba(15, 23, 42, 0.2);
}

[data-theme="dark"] {
  --hub-bg-page: #0b0f19;
  --hub-bg-rail: #111827;
  --hub-bg-card: #162032;
  --hub-border: #233044;
  --hub-border-subtle: #1e293b;
  --hub-text-main: #f8fafc;
  --hub-text-muted: #94a3b8;
  --hub-text-subtle: #64748b;
  --hub-accent: #388bfd;
  --hub-accent-hover: #1f6feb;
  --hub-accent-soft: rgba(56, 139, 253, 0.15);
  --hub-success: #22c55e;
  --hub-success-soft: rgba(34, 197, 94, 0.15);
  --hub-warning: #f59e0b;
  --hub-warning-soft: rgba(245, 158, 11, 0.15);
  --hub-danger: #f87171;
  --hub-danger-soft: rgba(248, 113, 113, 0.15);
  --hub-danger-text: #f87171;
  --hub-purple-soft: rgba(168, 85, 247, 0.15);
  --hub-purple-icon: #c084fc;
  --hub-input-bg: #111827;
  --shadow-card: 0 4px 20px rgba(0, 0, 0, 0.35);
  --shadow-modal: 0 20px 50px rgba(0, 0, 0, 0.6);
}

html, body {
  height: 100%;
  background: var(--hub-bg-page);
  color: var(--hub-text-main);
  font-family: var(--font);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}

/* ── Layout Shell: Rail + Content ────────────────────────────────── */
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

/* ── 1. Left Navigation Rail (220px) ────────────────────────────── */
.nav-rail {
  width: 220px;
  min-width: 220px;
  background: var(--hub-bg-rail);
  border-right: 1px solid var(--hub-border);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 16px 14px;
  user-select: none;
}

.rail-top {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.rail-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
}
.brand-cloud-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}
.brand-cloud-icon svg {
  width: 26px;
  height: 26px;
}
.rail-brand-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--hub-text-main);
  letter-spacing: -0.2px;
}

.rail-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: none;
}

.rail-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  color: var(--hub-text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
  transition: all 0.15s ease;
}
.rail-link:hover {
  background: var(--hub-accent-soft);
  color: var(--hub-accent);
}
.rail-link.is-active {
  background: var(--hub-accent-soft);
  color: var(--hub-accent);
  font-weight: 600;
}
.rail-link svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.rail-footer {
  padding: 12px 8px;
  border-top: 1px solid var(--hub-border-subtle);
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.rail-ide-logo {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--hub-text-main);
  flex-shrink: 0;
}
.rail-footer-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.rail-ide-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--hub-text-main);
}
.rail-ide-tagline {
  font-size: 11px;
  color: var(--hub-text-muted);
}
.rail-ide-version {
  font-size: 10px;
  color: var(--hub-text-subtle);
}

/* ── 2. Main Content Canvas ──────────────────────────────────────── */
.main-canvas {
  flex: 1;
  min-width: 0;
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px 24px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Header ─────────────────────────────────────────────────────── */
.hub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.header-brand-group {
  display: flex;
  align-items: center;
  gap: 14px;
}
.brand-hero-cloud {
  display: flex;
  align-items: center;
  justify-content: center;
}
.header-titles h1 {
  font-size: 22px;
  font-weight: 700;
  color: var(--hub-text-main);
  letter-spacing: -0.3px;
  line-height: 1.2;
}
.header-titles p {
  font-size: 13px;
  color: var(--hub-text-muted);
  margin-top: 3px;
}

.header-action-dock {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-new-cs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--hub-accent);
  color: #ffffff;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(11, 117, 240, 0.3);
  transition: background 0.15s ease, transform 0.1s ease;
}
.btn-new-cs:hover {
  background: var(--hub-accent-hover);
  transform: translateY(-1px);
}
.btn-new-cs svg {
  stroke: #ffffff;
  width: 14px;
  height: 14px;
}

.btn-header-secondary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--hub-bg-card);
  color: var(--hub-text-main);
  border: 1px solid var(--hub-border);
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-header-secondary:hover {
  border-color: var(--hub-accent);
  color: var(--hub-accent);
  background: var(--hub-accent-soft);
}
.btn-header-secondary svg {
  width: 14px;
  height: 14px;
}

.btn-header-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hub-bg-card);
  border: 1px solid var(--hub-border);
  border-radius: 8px;
  color: var(--hub-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-header-icon:hover {
  border-color: var(--hub-accent);
  color: var(--hub-accent);
}

.header-account-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--hub-bg-card);
  border: 1px solid var(--hub-border);
  border-radius: 20px;
  padding: 3px 10px 3px 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.header-account-trigger:hover {
  border-color: var(--hub-accent);
}
.header-acc-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #334155;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── 3. KPI Metrics Row (4 Cards) ────────────────────────────────── */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
}

.kpi-card {
  background: var(--hub-bg-card);
  border: 1px solid var(--hub-border);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  box-shadow: var(--shadow-card);
  min-height: 84px;
}
.kpi-icon-box {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.kpi-icon-box svg {
  width: 22px;
  height: 22px;
}
.kpi-icon-workspaces {
  background: var(--hub-accent-soft);
  color: var(--hub-accent);
}
.kpi-icon-running {
  background: var(--hub-success-soft);
  color: var(--hub-success);
}
.kpi-icon-stopped {
  background: var(--hub-warning-soft);
  color: var(--hub-warning);
}
.kpi-icon-storage {
  background: var(--hub-purple-soft);
  color: var(--hub-purple-icon);
}

.kpi-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kpi-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--hub-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.kpi-value {
  font-size: 26px;
  font-weight: 700;
  color: var(--hub-text-main);
  line-height: 1.1;
}
.kpi-card-storage .kpi-value {
  font-size: 17px;
  margin-top: 2px;
}
.kpi-chevron {
  color: var(--hub-text-subtle);
  display: flex;
  align-items: center;
}

/* ── 4. Toolbar Row (Chips + Search + Toggle) ─────────────────────── */
.hub-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.chips-scroll-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.account-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--hub-bg-card);
  border: 1px solid var(--hub-border);
  border-radius: 20px;
  padding: 4px 10px;
  color: var(--hub-text-main);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}
.account-chip:hover {
  border-color: var(--hub-accent);
}
.account-chip.is-active {
  border-color: var(--hub-accent);
  background: var(--hub-accent-soft);
  color: var(--hub-accent);
  font-weight: 600;
}
.chip-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 9px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.chip-count {
  font-size: 11px;
  background: var(--hub-border-subtle);
  color: var(--hub-text-muted);
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
}
.account-chip.is-active .chip-count {
  background: var(--hub-accent);
  color: #ffffff;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--hub-input-bg);
  border: 1px solid var(--hub-border);
  border-radius: 9px;
  padding: 6px 12px;
  width: 380px;
  max-width: 100%;
  transition: border-color 0.15s ease;
}
.search-box:focus-within {
  border-color: var(--hub-accent);
}
.search-icon {
  color: var(--hub-text-subtle);
  display: flex;
}
.search-input {
  border: none;
  background: transparent;
  color: var(--hub-text-main);
  font-size: 12px;
  width: 100%;
  outline: none;
}
.search-keycap {
  font-size: 10px;
  font-family: var(--mono-font);
  color: var(--hub-text-muted);
  background: var(--hub-border-subtle);
  border: 1px solid var(--hub-border);
  border-radius: 4px;
  padding: 1px 5px;
}

.view-mode-group {
  display: flex;
  align-items: center;
  border: 1px solid var(--hub-border);
  border-radius: 8px;
  background: var(--hub-bg-card);
  overflow: hidden;
}
.btn-view-mode {
  width: 34px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--hub-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-view-mode.is-active {
  background: var(--hub-accent-soft);
  color: var(--hub-accent);
}

/* ── 5. Workspace Grid (4 Columns) ───────────────────────────────── */
.workspace-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.ws-card {
  background: var(--hub-bg-card);
  border: 1px solid var(--hub-border);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  box-shadow: var(--shadow-card);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  min-width: 0;
}
.ws-card:hover {
  border-color: #b5c7de;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
}
[data-theme="dark"] .ws-card:hover {
  border-color: var(--hub-accent);
}

.ws-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ws-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.status-indicator {
  position: relative;
  width: 10px;
  height: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.status-running .status-dot { background: var(--hub-success); }
.status-stopped .status-dot { background: var(--hub-text-subtle); }
.status-transitioning .status-dot,.status-unknown .status-dot { background: var(--hub-warning); }
.status-pulse {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--hub-success);
  animation: radar-pulse 2s cubic-bezier(0.25, 1, 0.5, 1) infinite;
}
@keyframes radar-pulse {
  0% { transform: scale(0.6); opacity: 0.9; }
  100% { transform: scale(2.2); opacity: 0; }
}

.ws-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--hub-text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-more {
  border: none;
  background: transparent;
  color: var(--hub-text-subtle);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  width: 28px;
  height: 28px;
  transition: all 0.15s ease;
}
.btn-more:hover, .btn-more.is-active {
  color: var(--hub-text-main);
  background: var(--hub-border-subtle);
}

.ws-dropdown-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.ws-card-menu {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--hub-bg-card);
  border: 1px solid var(--hub-border);
  border-radius: 8px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
  min-width: 195px;
  padding: 6px;
  z-index: 1000;
  flex-direction: column;
  gap: 2px;
}
.ws-card-menu.is-open {
  display: flex;
  animation: menu-pop 0.12s ease-out;
}
@keyframes menu-pop {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--hub-text-main);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: all 0.1s ease;
}
.menu-item:hover {
  background: var(--hub-accent-soft);
  color: var(--hub-accent);
}
.menu-item svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.menu-divider {
  height: 1px;
  background: var(--hub-border-subtle);
  margin: 3px 0;
}
.menu-item-danger {
  color: var(--hub-danger);
}
.menu-item-danger:hover {
  background: var(--hub-danger-soft);
  color: var(--hub-danger);
}

.ws-user-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ws-user-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.user-avatar-small {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 8px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.user-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--hub-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.badge-running {
  background: var(--hub-success-soft);
  color: var(--hub-success);
}
.badge-stopped {
  background: var(--hub-danger-soft);
  color: var(--hub-danger-text);
}
.badge-transitioning,.badge-unknown { background: var(--hub-warning-soft); color: var(--hub-warning); }
.lifecycle-state-note { font-size: 11px; line-height: 1.25; color: var(--hub-warning); }
.kpi-hint { font-size: 10px; line-height: 1.2; color: var(--hub-text-muted); }

.ws-meta-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
}
.meta-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--hub-text-muted);
  min-width: 0;
}
.meta-icon {
  display: flex;
  color: var(--hub-text-subtle);
  flex-shrink: 0;
}
.meta-repo {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branch-pill {
  background: var(--hub-border-subtle);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: var(--mono-font);
  font-size: 11px;
  color: var(--hub-text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-row-split {
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.meta-time-group, .meta-idle-group {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
}
.idle-icon { color: var(--hub-warning); }
.idle-text { color: var(--hub-warning); font-weight: 500; }

/* Action Dock at bottom of cards */
.ws-action-dock {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--hub-border-subtle);
}
.action-primary-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}
.btn-connect {
  background: var(--hub-accent);
  color: #ffffff;
}
.btn-connect:hover { background: var(--hub-accent-hover); }
.btn-connect svg polygon { fill: #ffffff; }

.btn-stop {
  background: var(--hub-danger-soft);
  color: var(--hub-danger-text);
  border: 1px solid rgba(239, 68, 68, 0.2);
}
.btn-stop:hover { background: #fecaca; }

.btn-start {
  background: var(--hub-success);
  color: #ffffff;
}
.btn-start:hover { background: #15803d; }
.btn-start svg polygon { fill: #ffffff; }

.action-utility-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.util-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid var(--hub-border);
  background: transparent;
  color: var(--hub-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}
.util-btn:hover {
  background: var(--hub-border-subtle);
  color: var(--hub-text-main);
  border-color: var(--hub-text-subtle);
}
.btn-util-delete:hover {
  color: var(--hub-danger);
  border-color: rgba(239, 68, 68, 0.3);
  background: var(--hub-danger-soft);
}

/* ── 6. Workspace Table (List View) ──────────────────────────────── */
.workspace-table-wrap {
  display: none;
  background: var(--hub-bg-card);
  border: 1px solid var(--hub-border);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow-card);
}
.workspace-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 12px;
}
.workspace-table th {
  background: var(--hub-border-subtle);
  color: var(--hub-text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 10px 14px;
  letter-spacing: 0.5px;
}
.workspace-table td {
  padding: 10px 14px;
  border-top: 1px solid var(--hub-border-subtle);
  color: var(--hub-text-main);
}
.col-status {
  display: flex;
  align-items: center;
  gap: 8px;
}
.table-ws-name { font-weight: 700; font-size: 13px; }
.table-acc-pill {
  background: var(--hub-border-subtle);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}
.table-action-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
.btn-sm { height: 26px; padding: 0 8px; font-size: 11px; }

/* ── 7. Empty & Error States ─────────────────────────────────────── */
.account-error-banner {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  margin-bottom: 12px;
  background: var(--hub-bg-card);
  border: 1px solid #d29922;
  border-left: 4px solid #d29922;
  border-radius: 10px;
}
.account-error-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--hub-text-main);
}
.account-error-msg {
  font-size: 12px;
  color: var(--hub-text-muted);
  word-break: break-word;
}
.main-canvas.is-signed-out > :not(.hub-header):not(.workspace-grid) { display: none !important; }
.main-canvas.is-signed-out .header-action-dock { display: none; }
.main-canvas.is-signed-out .workspace-grid { flex: 1; display: flex; align-items: center; justify-content: center; }
.main-canvas.is-signed-out .empty-state-canvas { max-width: 440px; border-style: solid; box-shadow: var(--shadow-card); }
.ws-card.is-cached { opacity: .72; }
.ws-card.is-cached .action-btn[disabled] { cursor: not-allowed; }
.cached-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #b45309; background: rgba(217,119,6,.12); border: 1px solid rgba(217,119,6,.4); border-radius: 10px; padding: 1px 7px; margin-left: 6px; }
.empty-state-canvas {
  grid-column: 1 / -1;
  text-align: center;
  padding: 60px 20px;
  background: var(--hub-bg-card);
  border: 1px dashed var(--hub-border);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.empty-hero-box svg {
  width: 100px;
  height: 74px;
  color: var(--hub-text-subtle);
}
.empty-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--hub-text-main);
}
.empty-sub {
  font-size: 13px;
  color: var(--hub-text-muted);
  max-width: 380px;
  line-height: 1.4;
}

.filtered-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 60px 20px;
  background: var(--hub-bg-card);
  border: 1px dashed var(--hub-border);
  border-radius: 14px;
  width: 100%;
  gap: 12px;
}
.filtered-empty-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--hub-accent-soft);
  color: var(--hub-accent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.filtered-empty-icon svg {
  width: 20px;
  height: 20px;
}
.filtered-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--hub-text-main);
}
.btn-clear-search {
  background: var(--hub-bg-card);
  border: 1px solid var(--hub-border);
  color: var(--hub-accent);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-clear-search:hover {
  background: var(--hub-accent-soft);
  border-color: var(--hub-accent);
}

/* ── 8. Floating Toast ────────────────────────────────────────────── */
.hub-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: var(--hub-bg-card);
  border: 1px solid var(--hub-border);
  color: var(--hub-text-main);
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  z-index: 999;
  display: none;
  align-items: center;
  gap: 8px;
}
.hub-toast.show { display: flex; animation: toast-in 0.2s ease-out; }
@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── 9. Modals & Dialogs Layer ───────────────────────────────────── */
.modal-scrim {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 900;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.modal-scrim.is-open { display: flex; }

.modal-dialog {
  background: var(--hub-bg-card);
  border: 1px solid var(--hub-border);
  border-radius: 14px;
  width: 480px;
  max-width: 95vw;
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modal-pop 0.2s ease-out;
}
@keyframes modal-pop {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--hub-border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--hub-text-main);
}
.modal-close {
  background: transparent;
  border: none;
  color: var(--hub-text-muted);
  cursor: pointer;
  padding: 4px;
  display: flex;
}
.modal-close:hover { color: var(--hub-text-main); }

.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 70vh;
  overflow-y: auto;
}

.modal-footer {
  padding: 14px 20px;
  border-top: 1px solid var(--hub-border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

/* Wizard Specific Styles */
.wizard-progress-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--hub-text-muted);
  font-weight: 500;
}
.wizard-dots {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wiz-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--hub-border-subtle);
}
.wiz-dot.active {
  background: var(--hub-accent);
  width: 18px;
  border-radius: 10px;
}

.wizard-subtitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--hub-text-main);
}

.wizard-acc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border: 1px solid var(--hub-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.wizard-acc-row:hover, .wizard-acc-row.is-active {
  border-color: var(--hub-accent);
  background: var(--hub-accent-soft);
}
.acc-row-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.acc-row-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.acc-row-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--hub-text-main);
  display: flex;
  align-items: center;
  gap: 6px;
}
.pill-active-badge {
  font-size: 10px;
  color: var(--hub-success);
  font-weight: 600;
}
.acc-row-sub {
  font-size: 11px;
  color: var(--hub-text-muted);
}

/* Repository List in Wizard */
.repo-search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--hub-border);
  border-radius: 8px;
  font-size: 12px;
  background: var(--hub-input-bg);
  color: var(--hub-text-main);
  outline: none;
}
.repo-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}
.repo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border: 1px solid var(--hub-border-subtle);
  border-radius: 8px;
  cursor: pointer;
}
.repo-item:hover, .repo-item.is-selected {
  border-color: var(--hub-accent);
  background: var(--hub-accent-soft);
}
.repo-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--hub-text-main);
}
.badge-privacy {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}
.badge-privacy.private { background: #fef3c7; color: #92400e; }
.badge-privacy.public { background: #dcfce7; color: #166534; }

.repo-manual-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--hub-accent);
  font-size: 12px;
  font-weight: 500;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px 0;
}

/* Info Callout Banner */
.info-callout-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--hub-accent-soft);
  border: 1px solid rgba(11, 117, 240, 0.2);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--hub-accent);
  font-size: 12px;
}

/* Provisioning step */
.provisioning-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 10px;
  gap: 12px;
}
.prov-cloud-icon svg { width: 54px; height: 54px; color: var(--hub-accent); }
.prov-title { font-size: 14px; color: var(--hub-text-muted); }
.prov-repo-name { font-size: 16px; font-weight: 700; color: var(--hub-accent); }
.prov-progress-track {
  width: 100%;
  height: 6px;
  background: var(--hub-border-subtle);
  border-radius: 6px;
  overflow: hidden;
  margin-top: 8px;
}
.prov-progress-bar {
  width: 45%;
  height: 100%;
  background: var(--hub-accent);
  border-radius: 6px;
  animation: prov-bar-anim 1.5s infinite ease-in-out;
}
@keyframes prov-bar-anim {
  0% { transform: translateX(-100%); }
  50% { transform: translateX(120%); width: 70%; }
  100% { transform: translateX(250%); width: 45%; }
}
.prov-hint { font-size: 12px; color: var(--hub-text-subtle); }

/* Rebuild Options */
.rebuild-option-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--hub-border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.rebuild-option-card:hover {
  border-color: var(--hub-accent);
  background: var(--hub-accent-soft);
}
.rebuild-icon-badge {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.rebuild-badge-blue { background: var(--hub-accent-soft); color: var(--hub-accent); }
.rebuild-badge-red { background: var(--hub-danger-soft); color: var(--hub-danger); }
.rebuild-meta h4 { font-size: 13px; font-weight: 700; color: var(--hub-text-main); }
.rebuild-meta p { font-size: 11px; color: var(--hub-text-muted); margin-top: 2px; }

/* Delete Dialog */
.delete-dialog-body {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 10px;
  gap: 12px;
}
.delete-icon-circle {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: var(--hub-danger-soft);
  display: flex;
  align-items: center;
  justify-content: center;
}
.delete-dialog-title { font-size: 15px; font-weight: 700; color: var(--hub-text-main); }
.delete-dialog-desc { font-size: 12px; color: var(--hub-text-main); font-weight: 600; }
.delete-dialog-impact { font-size: 12px; color: var(--hub-text-muted); line-height: 1.45; }

/* Buttons in modal */
.btn-dialog-default {
  background: transparent;
  border: 1px solid var(--hub-border);
  color: var(--hub-text-main);
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-dialog-default:hover { background: var(--hub-border-subtle); }

.btn-dialog-primary {
  background: var(--hub-accent);
  border: none;
  color: #ffffff;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-dialog-primary:hover { background: var(--hub-accent-hover); }

.btn-dialog-danger {
  background: #dc2626;
  border: none;
  color: #ffffff;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-dialog-danger:hover { background: #b91c1c; }

/* ── Responsive Constraints ─────────────────────────────────────── */
@media (max-width: 1280px) {
  .workspace-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .kpi-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 960px) {
  .workspace-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 768px) {
  .nav-rail { width: 64px; min-width: 64px; padding: 12px 6px; }
  .rail-brand-name, .rail-link span, .rail-footer-meta { display: none; }
  .rail-link { justify-content: center; padding: 8px; }
  .rail-footer { justify-content: center; }
  .workspace-grid { grid-template-columns: 1fr; }
  .kpi-row { grid-template-columns: 1fr; }
  .search-box { width: 100%; }
}
${HUB_CSS}
${errorUx.UX_CSS}
</style>
</head>
<body>

<div class="app-shell">
  <!-- ── 1. Left Navigation Rail ──────────────────────────────────── -->
  <aside class="nav-rail">
    <div class="rail-top">
      <div class="rail-brand">
        <span class="brand-cloud-icon">${I.cloudBrand}</span>
        <span class="rail-brand-name">Codespaces</span>
      </div>

      <nav>
        <ul class="rail-menu">
          <li>
            <button class="rail-link is-active" id="railCloudHubBtn" title="Cloud Hub">
              ${I.home}
              <span>Cloud Hub</span>
            </button>
          </li>
          <li>
            <button class="rail-link" id="railMyCsBtn" title="My Codespaces">
              ${I.server}
              <span>My Codespaces</span>
            </button>
          </li>
          <li>
            <button class="rail-link" id="railUsageBtn" title="Usage">
              ${I.clock}
              <span>Usage</span>
            </button>
          </li>
          <li>
            <button class="rail-link" id="railCreateBtn" title="Create New">
              ${I.plus}
              <span>Create New</span>
            </button>
          </li>
          <li>
            <button class="rail-link" id="railAccountsBtn" title="Accounts">
              ${I.user}
              <span>Accounts</span>
            </button>
          </li>
          <li>
            <button class="rail-link" id="railSettingsBtn" title="Settings">
              ${I.settings}
              <span>Settings</span>
            </button>
          </li>
        </ul>
      </nav>
    </div>

    <!-- Rail Footer / Antigravity IDE Brand -->
    <div class="rail-footer">
      <div class="rail-ide-logo">${I.antigravityLogo}</div>
      <div class="rail-footer-meta">
        <span class="rail-ide-title">Antigravity IDE</span>
        <span class="rail-ide-tagline">Build anywhere.</span>
        <span class="rail-ide-version">${EXT_VERSION ? 'v' + escapeHtml(EXT_VERSION) : ''}</span>
      </div>
    </div>
  </aside>

  <!-- ── 2. Main Content Canvas ───────────────────────────────────── -->
  <main class="main-canvas${isLoggedOut ? ' is-signed-out' : ''}">

    <!-- Page Header -->
    <header class="hub-header">
      <div class="header-brand-group">
        <div class="brand-hero-cloud">${I.cloudBrand}</div>
        <div class="header-titles">
          <h1>Antigravity Codespaces Cloud Hub</h1>
          <p>Multi-Account Cloud Workspace Director</p>
        </div>
      </div>

      <div class="header-action-dock">
        <button class="btn-new-cs" id="btnNewCs">
          ${I.plus} <span>New Codespace</span>
        </button>
        <button class="btn-header-secondary" id="btnSyncSsh" title="Write ProxyCommand SSH configs">
          ${I.sync} <span>Sync SSH</span>
        </button>
        <button class="btn-header-secondary" id="btnRefresh" title="Fetch latest status">
          ${I.refresh} <span>Refresh</span>
        </button>
        <button class="btn-header-icon" id="btnThemeToggle" title="Toggle Dark / Light Theme" aria-label="Toggle Theme">
          <span id="themeIcon">${I.sun}</span>
        </button>
        <div class="header-account-trigger" id="btnAccountTrigger" title="Switch GitHub Account">
          <span class="header-acc-avatar">${escapeHtml(getInitials(activeAccount))}</span>
          <span style="color:var(--hub-text-subtle);">${I.chevronDown}</span>
        </div>
      </div>
    </header>

    <!-- ── Usage (active gh account) ─────────────────────────────────── -->
    ${hubUsageCardHtml(this._usageCard || this._usage, I.clock, this._usageOpts)}

    <!-- ── 3. KPI Metrics Row (4 Cards) ────────────────────────────── -->
    <section class="kpi-row">
      <!-- Total Workspaces -->
      <div class="kpi-card">
        <div class="kpi-icon-box kpi-icon-workspaces">${I.server}</div>
        <div class="kpi-meta">
          <span class="kpi-label">TOTAL WORKSPACES</span>
          <span class="kpi-value" id="kpiTotalCount">${total}</span>
        </div>
      </div>

      <!-- Running Instances -->
      <div class="kpi-card">
        <div class="kpi-icon-box kpi-icon-running">${I.power}</div>
        <div class="kpi-meta">
          <span class="kpi-label">RUNNING INSTANCES</span>
          <span class="kpi-value" id="kpiRunningCount" style="color:var(--hub-success);">${online}</span>
        </div>
      </div>

      <!-- Stopped (compute paused; storage can still be billed) -->
      <div class="kpi-card">
        <div class="kpi-icon-box kpi-icon-stopped">${I.clock}</div>
        <div class="kpi-meta">
          <span class="kpi-label">STOPPED</span>
          <span class="kpi-value" id="kpiStoppedCount">${offline}</span>
          <span class="kpi-hint" id="kpiOtherCount">${otherStates ? `${otherStates} starting or state unavailable` : ''}</span>
        </div>
      </div>

      <!-- Storage Tier -->
      <div class="kpi-card kpi-card-storage" id="kpiCardStorage" style="cursor:pointer;${storageTierText(this._usageCard || this._usage) ? '' : 'display:none;'}" title="Included storage for your plan (from GitHub)">
        <div class="kpi-icon-box kpi-icon-storage">${I.shield}</div>
        <div class="kpi-meta">
          <span class="kpi-label">STORAGE TIER</span>
          <span class="kpi-value">${escapeHtml(storageTierText(this._usageCard || this._usage))}</span>
        </div>
        <div class="kpi-chevron">${I.chevronRight}</div>
      </div>
    </section>

    <!-- ── 4. Toolbar: Account Chips + Search + Toggle ──────────────── -->
    <section class="hub-toolbar">
      <div class="chips-scroll-wrap">
        <button class="account-chip is-active" data-acc="ALL">
          <span class="chip-avatar" style="background:#0b75f0; color:#fff;">ALL</span>
          <span class="chip-name">All Accounts</span>
          <span class="chip-count">${flat.length}</span>
        </button>
        ${accountChipsHtml}
      </div>

      <div class="toolbar-right">
        <div class="search-box">
          <span class="search-icon">${I.search}</span>
          <input type="text" id="q" class="search-input" placeholder="Search by name, repository, branch... (Press / to focus)">
          <span class="search-keycap">/</span>
        </div>

        <div class="view-mode-group">
          <button class="btn-view-mode is-active" id="btnViewGrid" title="Grid View" aria-label="Grid View">${I.grid}</button>
          <button class="btn-view-mode" id="btnViewList" title="List View" aria-label="List View">${I.list}</button>
        </div>
      </div>
    </section>

    <!-- ── 5. Workspace Grid (Cards) ────────────────────────────────── -->
    ${accountErrorsHtml}
    ${DashboardProvider.usageBanner(this._usageCard || this._usage, (vscode.workspace.getConfiguration('antigravity-codespaces').get('usage.alertThresholds') || [75, 90]))}
    <section class="workspace-grid" id="workspaceGrid">
      ${cardsHtml.length > 0 ? cardsHtml : accountErrors.length && !isLoggedOut ? '' : (isLoggedOut ? `
        <div class="empty-state-canvas">
          <div class="empty-hero-box">${I.emptyHero}</div>
          <h4 class="empty-title">You're signed out.</h4>
          <p class="empty-sub">Sign in to the extension with GitHub to browse your Codespaces. SSH connections use the separate GitHub CLI (<code>gh</code>) account.</p>
          <button class="btn-new-cs" data-cmd="loginGitHub">
            ${I.key} <span>Sign in to extension</span>
          </button>
        </div>
      ` : `
        <div class="empty-state-canvas">
          <div class="empty-hero-box">${I.emptyHero}</div>
          <h4 class="empty-title">No codespaces yet.</h4>
          <p class="empty-sub">Create one from any repository you can access.</p>
          <button class="btn-new-cs" data-cmd="triggerNewCs">
            ${I.plus} <span>Create codespace</span>
          </button>
        </div>
      `)}
    </section>

    <!-- ── 6. Workspace Table (List View) ───────────────────────────── -->
    <section class="workspace-table-wrap" id="workspaceTableWrap">
      <table class="workspace-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Workspace</th>
            <th>Account</th>
            <th>Repository</th>
            <th>Branch</th>
            <th>Machine</th>
            <th>Last Active</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody id="workspaceTableBody">
          ${tableRowsHtml}
        </tbody>
      </table>
    </section>

    <!-- ── 6b. Filtered Empty State (Section 39) ────────────────────── -->
    <div class="filtered-empty-state" id="filteredEmpty" style="display:none;">
      <div class="filtered-empty-icon">${I.search}</div>
      <p class="filtered-empty-title">No Codespaces match your search.</p>
      <button class="btn-clear-search" id="btnClearSearch">Clear search</button>
    </div>

    ${hubUsagePageHtml(this._usage, this._usageOpts)}
  </main>
</div>

<!-- ── 7. Floating Toast ─────────────────────────────────────────── -->
<div class="hub-toast" id="toast">
  <span style="color:var(--hub-success); display:flex;">${I.checkCircle}</span>
  <span id="toastMsg"></span>
</div>

<!-- ── 8. Modal: Create New Codespace 4-Step Wizard ──────────────── -->
<div class="modal-scrim" id="wizardModal">
  <div class="modal-dialog">
    <div class="modal-header">
      <h3 class="modal-title" id="wizardTitle">Create New Codespace</h3>
      <button class="modal-close" id="wizardCloseBtn">${I.close}</button>
    </div>

    <!-- Step 1: Select Account -->
    <div class="modal-body wizard-step" id="wizardStep1">
      <div class="wizard-progress-bar">
        <span>Step 1 of 4</span>
        <div class="wizard-dots">
          <span class="wiz-dot active"></span>
          <span class="wiz-dot"></span>
          <span class="wiz-dot"></span>
          <span class="wiz-dot"></span>
        </div>
      </div>
      <div class="wizard-subtitle">Select GitHub account for new Codespace</div>
      <div class="wizard-acc-list">
        ${wizardAccountsHtml}
      </div>
    </div>

    <!-- Step 2: Select Repository -->
    <div class="modal-body wizard-step" id="wizardStep2" style="display:none;">
      <div class="wizard-progress-bar">
        <span>Step 2 of 4</span>
        <div class="wizard-dots">
          <span class="wiz-dot"></span>
          <span class="wiz-dot active"></span>
          <span class="wiz-dot"></span>
          <span class="wiz-dot"></span>
        </div>
      </div>
      <input type="text" id="repoSearchInput" class="repo-search-input" placeholder="Search repositories...">
      <div class="repo-list" id="wizardRepoList">
        <div style="padding:16px;text-align:center;color:var(--hub-text-muted);">Loading repositories...</div>
      </div>
      <button class="repo-manual-btn" id="btnRepoManual">
        ${I.pencil} <span>Enter repository manually...</span>
      </button>
      <div id="manualRepoBox" style="display:none; margin-top:12px;">
        <input type="text" id="manualRepoInput" class="repo-search-input" placeholder="owner/repo (e.g. facebook/react)" style="margin-bottom:8px;">
        <button class="btn-dialog-primary" id="btnApplyManualRepo" style="width:100%;">Use Repository</button>
      </div>
    </div>

    <!-- Step 3: Choose Branch -->
    <div class="modal-body wizard-step" id="wizardStep3" style="display:none;">
      <div class="wizard-progress-bar">
        <span>Step 3 of 4</span>
        <div class="wizard-dots">
          <span class="wiz-dot"></span>
          <span class="wiz-dot"></span>
          <span class="wiz-dot active"></span>
          <span class="wiz-dot"></span>
        </div>
      </div>
      <div class="wizard-subtitle">Branch name (leave empty for default)</div>
      <input type="text" id="branchInput" class="repo-search-input" value="" placeholder="Default branch (leave empty)">
      <div class="info-callout-banner">
        ${I.info} <span>If left empty, the default branch will be used.</span>
      </div>
    </div>

    <!-- Step 4: Provisioning -->
    <div class="modal-body wizard-step" id="wizardStep4" style="display:none;">
      <div class="wizard-progress-bar">
        <span>Step 4 of 4</span>
        <div class="wizard-dots">
          <span class="wiz-dot"></span>
          <span class="wiz-dot"></span>
          <span class="wiz-dot"></span>
          <span class="wiz-dot active"></span>
        </div>
      </div>
      <div class="provisioning-box">
        <div class="prov-cloud-icon">${I.cloudBrand}</div>
        <div class="prov-title">Creating Codespace on</div>
        <div class="prov-repo-name" id="provRepoName">repository</div>
        <div class="prov-progress-track">
          <div class="prov-progress-bar"></div>
        </div>
        <div class="prov-hint">This may take a few minutes...</div>
      </div>
    </div>

    <div class="modal-footer" id="wizardFooter">
      <button class="btn-dialog-default" id="wizardBackBtn">Cancel</button>
      <button class="btn-dialog-primary" id="wizardNextBtn">Next →</button>
    </div>
  </div>
</div>

<!-- ── 9. Modal: Rebuild DevContainer ────────────────────────────── -->
<div class="modal-scrim" id="rebuildModal">
  <div class="modal-dialog">
    <div class="modal-header">
      <h3 class="modal-title">Rebuild DevContainer</h3>
      <button class="modal-close" data-cmd="closeRebuildModal">${I.close}</button>
    </div>
    <div class="modal-body">
      <div class="wizard-subtitle" id="rebuildTargetTitle">Choose the type of rebuild:</div>
      <div class="rebuild-option-card" id="optStandardRebuild">
        <div class="rebuild-icon-badge rebuild-badge-blue">${I.sync}</div>
        <div class="rebuild-meta">
          <h4>Standard Rebuild</h4>
          <p>Uses layer cache (faster)</p>
        </div>
      </div>
      <div class="rebuild-option-card" id="optFullRebuild">
        <div class="rebuild-icon-badge rebuild-badge-red">${I.trash}</div>
        <div class="rebuild-meta">
          <h4>Full Rebuild (no cache)</h4>
          <p>Clean container rebuild from scratch</p>
        </div>
      </div>
    </div>
    <div class="modal-footer" style="justify-content:flex-end;">
      <button class="btn-dialog-default" data-cmd="closeRebuildModal">Cancel</button>
    </div>
  </div>
</div>

<!-- ── 10. Modal: Delete Codespace Confirmation ──────────────────── -->
<div class="modal-scrim" id="deleteModal">
  <div class="modal-dialog" style="width:400px;">
    <div class="modal-header">
      <h3 class="modal-title">Delete Codespace</h3>
      <button class="modal-close" data-cmd="closeDeleteModal">${I.close}</button>
    </div>
    <div class="modal-body delete-dialog-body">
      <div class="delete-icon-circle">${I.trashModal}</div>
      <div class="delete-dialog-title" id="deleteTargetPrompt">Delete codespace?</div>
      <p class="delete-dialog-desc" id="deleteTargetDetails"></p>
      <p class="delete-dialog-impact">This cannot be undone; uncommitted Codespace changes may be lost. Deleting removes this workspace and stops further storage accrual after GitHub removes it. The repository itself is not deleted.</p>
    </div>
    <div class="modal-footer">
      <button class="btn-dialog-default" data-cmd="closeDeleteModal">Cancel</button>
      <button class="btn-dialog-danger" id="btnConfirmDelete">Delete</button>
    </div>
  </div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// ── Toast Notification System ─────────────────────────────────────────
let toastTimer = null;
function showToast(msg, ms = 3000) {
  const el = document.getElementById('toast');
  const msgEl = document.getElementById('toastMsg');
  if (!el || !msgEl) return;
  msgEl.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ── Webview PostMessage Receiver ──────────────────────────────────────
window.addEventListener('message', event => {
  const msg = event.data;
  if (!msg) return;
  if (msg.command === 'toast') {
    showToast(msg.text);
  } else if (msg.command === 'reposLoaded') {
    renderWizardRepos(msg.repos);
  } else if (msg.command === 'reposError') {
    const error = msg.error || 'unknown error';
    showToast('Could not load repositories: ' + error);
    const listEl = document.getElementById('wizardRepoList');
    if (listEl) listEl.textContent = 'Repository list unavailable: ' + error + ' Try manual entry below.';
    const box = document.getElementById('manualRepoBox');
    if (box) box.style.display = 'block';
  } else if (msg.command === 'createSuccess') {
    showToast('Codespace created: ' + msg.name);
    setTimeout(() => {
      document.getElementById('wizardModal').classList.remove('is-open');
    }, 1200);
  } else if (msg.command === 'createError') {
    showToast(msg.error === 'Creation cancelled. No Codespace was created.' ? msg.error : 'Create failed: ' + msg.error);
    document.getElementById('wizardStep4').style.display = 'none';
    document.getElementById('wizardStep3').style.display = 'flex';
    document.getElementById('wizardFooter').style.display = 'flex';
  }
});

// ── Header Actions ────────────────────────────────────────────────────
document.getElementById('btnSyncSsh').addEventListener('click', () => {
  vscode.postMessage({ command: 'syncAllSSH' });
});
document.getElementById('btnRefresh').addEventListener('click', () => {
  const icon = document.getElementById('btnRefresh').querySelector('svg');
  if (icon) icon.style.animation = 'radar-pulse 1s infinite';
  vscode.postMessage({ command: 'refresh' });
});
document.getElementById('btnAccountTrigger').addEventListener('click', () => {
  vscode.postMessage({ command: 'switchAccount' });
});

// ── Left Rail Navigation ──────────────────────────────────────────────
document.getElementById('railCloudHubBtn').addEventListener('click', () => {
  document.querySelectorAll('.rail-link').forEach(l => l.classList.remove('is-active'));
  document.getElementById('railCloudHubBtn').classList.add('is-active');
});
document.getElementById('railMyCsBtn').addEventListener('click', () => {
  document.getElementById('q').focus();
});
document.getElementById('railCreateBtn').addEventListener('click', () => {
  openWizard();
});
document.getElementById('railAccountsBtn').addEventListener('click', () => {
  vscode.postMessage({ command: 'switchAccount' });
});
document.getElementById('railSettingsBtn').addEventListener('click', () => {
  vscode.postMessage({ command: 'openSettings' });
});

// ── Filter & Search Behavior ──────────────────────────────────────────
let activeFilter = 'ALL';
function persistHubState() {
  try {
    vscode.setState({
      q: document.getElementById('q')?.value || '',
      filter: activeFilter,
      view: document.getElementById('btnViewList')?.classList.contains('is-active') ? 'list' : 'grid'
    });
  } catch (e) { console.warn('Cloud Hub: could not save view state', e); }
}
function setFilter(acc) {
  activeFilter = acc;
  document.querySelectorAll('.account-chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.acc === acc);
  });
  filterCards();
  persistHubState();
}

document.querySelectorAll('.account-chip').forEach(chip => {
  chip.addEventListener('click', () => setFilter(chip.dataset.acc));
});

function filterCards() {
  const q = (document.getElementById('q').value || '').toLowerCase().trim();
  let visibleCount = 0;
  let filteredOnline = 0;
  let filteredOffline = 0;
  let filteredOther = 0;

  // Grid cards
  document.querySelectorAll('.ws-card').forEach(card => {
    const cardAcc = (card.dataset.account || '').toLowerCase();
    const matchAcc = (activeFilter === 'ALL' || cardAcc === activeFilter.toLowerCase());
    const name = (card.dataset.name || '').toLowerCase();
    const repo = (card.dataset.repo || '').toLowerCase();
    const branch = (card.dataset.branch || '').toLowerCase();
    const matchQ = !q || name.includes(q) || repo.includes(q) || branch.includes(q);

    const isMatch = matchAcc && matchQ;
    card.style.display = isMatch ? '' : 'none';
    if (isMatch) {
      visibleCount++;
      if (card.dataset.state === 'running') filteredOnline++;
      else if (card.dataset.state === 'stopped') filteredOffline++;
      else filteredOther++;
    }
  });

  // Table rows
  document.querySelectorAll('.table-row').forEach(row => {
    const rowAcc = (row.dataset.account || '').toLowerCase();
    const matchAcc = (activeFilter === 'ALL' || rowAcc === activeFilter.toLowerCase());
    const name = (row.dataset.name || '').toLowerCase();
    const repo = (row.dataset.repo || '').toLowerCase();
    const branch = (row.dataset.branch || '').toLowerCase();
    const matchQ = !q || name.includes(q) || repo.includes(q) || branch.includes(q);
    row.style.display = (matchAcc && matchQ) ? '' : 'none';
  });

  // Dynamically update KPI metric numbers to reflect the filtered slice
  const kpiTotal = document.getElementById('kpiTotalCount');
  const kpiRunning = document.getElementById('kpiRunningCount');
  const kpiStopped = document.getElementById('kpiStoppedCount');
  const kpiOther = document.getElementById('kpiOtherCount');
  if (kpiTotal) kpiTotal.textContent = visibleCount;
  if (kpiRunning) kpiRunning.textContent = filteredOnline;
  if (kpiStopped) kpiStopped.textContent = filteredOffline;
  if (kpiOther) kpiOther.textContent = filteredOther ? filteredOther + ' starting or state unavailable' : '';

  const totalCards = document.querySelectorAll('.ws-card').length;
  const filteredEmpty = document.getElementById('filteredEmpty');
  if (filteredEmpty) {
    if (totalCards > 0 && visibleCount === 0) {
      filteredEmpty.style.display = 'flex';
      if (document.getElementById('btnViewGrid').classList.contains('is-active')) {
        gridCanvas.style.display = 'none';
      } else {
        tableCanvas.style.display = 'none';
      }
    } else {
      filteredEmpty.style.display = 'none';
      if (document.getElementById('btnViewGrid').classList.contains('is-active')) {
        gridCanvas.style.display = 'grid';
      } else {
        tableCanvas.style.display = 'block';
      }
    }
  }
}

const qInput = document.getElementById('q');
qInput.addEventListener('input', () => { filterCards(); persistHubState(); });

document.getElementById('btnClearSearch')?.addEventListener('click', () => {
  qInput.value = '';
  filterCards();
  qInput.focus();
});

// Slash Keycap & Escape Handlers
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== qInput && !document.querySelector('.modal-scrim.is-open')) {
    e.preventDefault();
    qInput.focus();
    qInput.select();
  } else if (e.key === 'Escape') {
    document.querySelectorAll('.ws-card-menu').forEach(m => m.classList.remove('is-open'));
    if (document.querySelector('.modal-scrim.is-open')) {
      document.querySelectorAll('.modal-scrim').forEach(m => m.classList.remove('is-open'));
    } else if (document.activeElement === qInput) {
      qInput.value = '';
      filterCards();
      qInput.blur();
    }
  }
});

// ── View Mode Switcher (Grid vs List) ─────────────────────────────────
const btnGrid = document.getElementById('btnViewGrid');
const btnList = document.getElementById('btnViewList');
const gridCanvas = document.getElementById('workspaceGrid');
const tableCanvas = document.getElementById('workspaceTableWrap');

btnGrid.addEventListener('click', () => {
  btnGrid.classList.add('is-active');
  btnList.classList.remove('is-active');
  gridCanvas.style.display = 'grid';
  tableCanvas.style.display = 'none';
  persistHubState();
});

btnList.addEventListener('click', () => {
  btnList.classList.add('is-active');
  btnGrid.classList.remove('is-active');
  gridCanvas.style.display = 'none';
  tableCanvas.style.display = 'block';
  persistHubState();
});

// ── Restore UI state across full re-renders (search, filter, view mode) ──
try {
  const savedHubState = vscode.getState() || {};
  if (typeof savedHubState.q === 'string' && savedHubState.q) {
    qInput.value = savedHubState.q;
  }
  if (typeof savedHubState.filter === 'string' && savedHubState.filter) {
    activeFilter = savedHubState.filter;
    document.querySelectorAll('.account-chip').forEach(c => {
      c.classList.toggle('is-active', c.dataset.acc === activeFilter);
    });
  }
  if (savedHubState.view === 'list') {
    btnGrid.classList.remove('is-active');
    btnList.classList.add('is-active');
    gridCanvas.style.display = 'none';
    tableCanvas.style.display = 'block';
  }
  if ((savedHubState.q && String(savedHubState.q).trim()) || (savedHubState.filter && savedHubState.filter !== 'ALL')) {
    filterCards();
  }
} catch (e) { console.warn('Cloud Hub: could not restore view state', e); }

// ── Card Action Delegations ───────────────────────────────────────────
let currentActionTarget = null;

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  if (btn.classList.contains('ux-dismiss')) { const b = btn.closest('.ux-banner'); if (b) b.remove(); return; }
  if (btn.dataset.uxAction) {
    const a = btn.dataset.uxAction;
    if (a === 'openUsage') { const nav = document.getElementById('railUsageBtn'); if (nav) nav.click(); return; }
    if (a === 'workOffline') { const b = btn.closest('.ux-banner'); if (b) b.remove(); showToast('Working offline with cached data'); return; }
    if (a === 'retry') { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="btn-spin" aria-hidden="true"></span>Retrying…'; }
    vscode.postMessage({ command: 'uxAction', action: a, account: btn.dataset.acc || '' });
    return;
  }
  const cmd = btn.dataset.cmd;
  if (!cmd) return;

  if (cmd === 'closeRebuildModal') {
    closeRebuildModal();
    return;
  }
  if (cmd === 'closeDeleteModal') {
    closeDeleteModal();
    return;
  }
  if (cmd === 'triggerNewCs') {
    document.getElementById('btnNewCs').click();
    return;
  }
  if (cmd === 'loginGitHub') {
    vscode.postMessage({ command: 'loginGitHub' });
    return;
  }

  const name = btn.dataset.name;
  const account = btn.dataset.acc;
  const repo = btn.dataset.repo;

  // Automatically close any open dropdown menu on click of action items
  if (cmd !== 'openMenu') {
    document.querySelectorAll('.ws-card-menu').forEach(m => m.classList.remove('is-open'));
  }

  switch (cmd) {
    case 'connect':
      btn.innerHTML = '<span class="btn-spin" aria-hidden="true"></span><span>Connecting…</span>';
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      vscode.postMessage({ command: 'connect', name, account, repo });
      break;
    case 'start':
      btn.innerHTML = '<span class="btn-spin" aria-hidden="true"></span><span>Starting…</span>';
      btn.disabled = true;
      vscode.postMessage({ command: 'start', name, account });
      break;
    case 'stop':
      btn.innerHTML = '<span class="btn-spin" aria-hidden="true"></span><span>Stopping…</span>';
      btn.disabled = true;
      vscode.postMessage({ command: 'stop', name, account });
      break;
    case 'testSSH':
      showToast('Testing SSH tunnel latency...');
      vscode.postMessage({ command: 'testSSH', name, account });
      break;
    case 'openWeb':
      vscode.postMessage({ command: 'openWeb', name });
      break;
    case 'copySSH':
      showToast('Copied: gh cs ssh -c ' + name);
      vscode.postMessage({ command: 'copySSH', name });
      break;
    case 'openRebuildModal':
      openRebuildModal(name, account);
      break;
    case 'openDeleteModal':
      openDeleteModal(name, account, btn.dataset.state, btn.dataset.repo, btn.dataset.displayName);
      break;
    case 'openMenu': {
      ev.stopPropagation();
      const card = btn.closest('.ws-card');
      const menu = card?.querySelector('.ws-card-menu');
      if (menu) {
        const wasOpen = menu.classList.contains('is-open');
        document.querySelectorAll('.ws-card-menu').forEach(m => m.classList.remove('is-open'));
        if (!wasOpen) menu.classList.add('is-open');
      }
      break;
    }
  }
});

// Close card menus when clicking outside
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('.ws-dropdown-wrap')) {
    document.querySelectorAll('.ws-card-menu').forEach(m => m.classList.remove('is-open'));
  }
});

// ── Rebuild Modal Logic ───────────────────────────────────────────────
function openRebuildModal(name, account) {
  currentActionTarget = { name, account };
  document.getElementById('rebuildTargetTitle').textContent = 'Rebuild "' + name + '"?';
  document.getElementById('rebuildModal').classList.add('is-open');
}
function closeRebuildModal() {
  document.getElementById('rebuildModal').classList.remove('is-open');
}
document.getElementById('optStandardRebuild').addEventListener('click', () => {
  if (!currentActionTarget) return;
  closeRebuildModal();
  vscode.postMessage({ command: 'rebuild', name: currentActionTarget.name, account: currentActionTarget.account, full: false });
});
document.getElementById('optFullRebuild').addEventListener('click', () => {
  if (!currentActionTarget) return;
  closeRebuildModal();
  vscode.postMessage({ command: 'rebuild', name: currentActionTarget.name, account: currentActionTarget.account, full: true });
});

// ── Delete Modal Logic ────────────────────────────────────────────────
function openDeleteModal(name, account, state, repo, displayName) {
  currentActionTarget = { name, account, state, repo, displayName };
  document.getElementById('deleteTargetPrompt').textContent = 'Delete "' + (displayName || name) + '"?';
  document.getElementById('deleteTargetDetails').textContent = 'GitHub account: ' + account + ' · Current state: ' + (state || 'unavailable') + (repo ? ' · Repository: ' + repo : '');
  document.getElementById('deleteModal').classList.add('is-open');
}
function closeDeleteModal() {
  document.getElementById('deleteModal').classList.remove('is-open');
}
document.getElementById('btnConfirmDelete').addEventListener('click', () => {
  if (!currentActionTarget) return;
  const { name, account, state, repo, displayName } = currentActionTarget;
  closeDeleteModal();
  vscode.postMessage({ command: 'delete', name, account, state, repo, displayName });
});

// ── Create New Codespace Wizard Logic ─────────────────────────────────
let wizardStep = 1;
let selectedAccount = '';
let selectedRepo = '';
let allLoadedRepos = [];

function openWizard() {
  wizardStep = 1;
  const checkedAcc = document.querySelector('input[name="wizardAccount"]:checked');
  selectedAccount = checkedAcc ? checkedAcc.value : '';
  selectedRepo = '';
  showWizardStep(1);
  document.getElementById('wizardModal').classList.add('is-open');
}

document.getElementById('btnNewCs').addEventListener('click', openWizard);
document.getElementById('wizardCloseBtn').addEventListener('click', () => {
  document.getElementById('wizardModal').classList.remove('is-open');
});

// Row click to select radio
document.querySelectorAll('.wizard-acc-row').forEach(row => {
  row.addEventListener('click', () => {
    document.querySelectorAll('.wizard-acc-row').forEach(r => r.classList.remove('is-active'));
    row.classList.add('is-active');
    const radio = row.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
    selectedAccount = row.dataset.acc;
  });
});

function showWizardStep(step) {
  wizardStep = step;
  document.getElementById('wizardStep1').style.display = step === 1 ? 'flex' : 'none';
  document.getElementById('wizardStep2').style.display = step === 2 ? 'flex' : 'none';
  document.getElementById('wizardStep3').style.display = step === 3 ? 'flex' : 'none';
  document.getElementById('wizardStep4').style.display = step === 4 ? 'flex' : 'none';

  const titleEl = document.getElementById('wizardTitle');
  const backBtn = document.getElementById('wizardBackBtn');
  const nextBtn = document.getElementById('wizardNextBtn');
  const footer = document.getElementById('wizardFooter');

  footer.style.display = step === 4 ? 'none' : 'flex';

  if (step === 1) {
    titleEl.textContent = 'Create New Codespace';
    backBtn.textContent = 'Cancel';
    nextBtn.textContent = 'Next →';
  } else if (step === 2) {
    titleEl.textContent = 'Select Repository';
    backBtn.textContent = '← Back';
    nextBtn.textContent = 'Next →';
    vscode.postMessage({ command: 'fetchRepos', account: selectedAccount });
  } else if (step === 3) {
    titleEl.textContent = 'Choose Branch';
    backBtn.textContent = '← Back';
    nextBtn.textContent = 'Next →';
  } else if (step === 4) {
    titleEl.textContent = 'Provisioning';
    document.getElementById('provRepoName').textContent = selectedRepo || 'Selected Repository';
    const branch = document.getElementById('branchInput').value || '';
    vscode.postMessage({ command: 'submitCreate', repo: selectedRepo, branch, account: selectedAccount });
  }
}

document.getElementById('wizardNextBtn').addEventListener('click', () => {
  if (wizardStep === 1) {
    const checked = document.querySelector('input[name="wizardAccount"]:checked');
    selectedAccount = checked ? checked.value : selectedAccount;
    showWizardStep(2);
  } else if (wizardStep === 2) {
    if (!selectedRepo) {
      showToast('Please pick a repository');
      return;
    }
    showWizardStep(3);
  } else if (wizardStep === 3) {
    showWizardStep(4);
  }
});

document.getElementById('wizardBackBtn').addEventListener('click', () => {
  if (wizardStep === 1) {
    document.getElementById('wizardModal').classList.remove('is-open');
  } else {
    showWizardStep(wizardStep - 1);
  }
});

function renderWizardRepos(repos) {
  allLoadedRepos = repos || [];
  const listEl = document.getElementById('wizardRepoList');
  if (!allLoadedRepos.length) {
    listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--hub-text-muted);">No repositories found. Try manual entry.</div>';
    return;
  }
  filterWizardRepos();
}

function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function filterWizardRepos() {
  const term = (document.getElementById('repoSearchInput').value || '').toLowerCase();
  const listEl = document.getElementById('wizardRepoList');
  const filtered = allLoadedRepos.filter(r => r.name.toLowerCase().includes(term) || (r.nameWithOwner || '').toLowerCase().includes(term));

  if (!filtered.length) {
    listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--hub-text-muted);">No matching repositories</div>';
    return;
  }

  listEl.innerHTML = filtered.slice(0, 30).map(r => {
    const isSel = selectedRepo === r.nameWithOwner;
    const safeFull = escAttr(r.nameWithOwner);
    const safeName = escAttr(r.name);
    return '<div class="repo-item ' + (isSel ? 'is-selected' : '') + '" data-fullname="' + safeFull + '">' +
      '<div class="repo-item-left">' +
        '<span style="color:var(--hub-text-subtle);display:flex;">' + '${I.repo.replace(/'/g, "\\'")}' + '</span>' +
        '<span>' + safeName + '</span>' +
      '</div>' +
      '<span class="badge-privacy ' + (r.isPrivate ? 'private' : 'public') + '">' +
        (r.isPrivate ? 'Private' : 'Public') +
      '</span>' +
    '</div>';
  }).join('');

  listEl.querySelectorAll('.repo-item').forEach(item => {
    item.addEventListener('click', () => {
      listEl.querySelectorAll('.repo-item').forEach(i => i.classList.remove('is-selected'));
      item.classList.add('is-selected');
      selectedRepo = item.dataset.fullname;
    });
  });
}

document.getElementById('repoSearchInput').addEventListener('input', filterWizardRepos);

document.getElementById('btnRepoManual')?.addEventListener('click', () => {
  const box = document.getElementById('manualRepoBox');
  const btn = document.getElementById('btnRepoManual');
  if (box) {
    const isHidden = box.style.display === 'none';
    box.style.display = isHidden ? 'block' : 'none';
    if (btn) btn.style.display = isHidden ? 'none' : 'flex';
    if (isHidden) {
      const inp = document.getElementById('manualRepoInput');
      if (inp) { inp.focus(); inp.select(); }
    }
  }
});

document.getElementById('btnApplyManualRepo')?.addEventListener('click', () => {
  const inp = document.getElementById('manualRepoInput');
  const manual = inp ? inp.value.trim() : '';
  const clean = manual.replace(/^https?:\\/\\/github\\.com\\//i, '').replace(/\\.git$/i, '').trim();
  const parts = clean.split('/').filter(Boolean);
  if (parts.length >= 2) {
    selectedRepo = parts[0] + '/' + parts[1];
    showWizardStep(3);
  } else {
    showToast('Enter repository in owner/repo format (e.g. facebook/react)');
  }
});

// ── Storage Tier Interaction (Section 12 & 104) ───────────────────────
document.getElementById('kpiCardStorage')?.addEventListener('click', () => {
  showToast('Storage: ${escapeHtml(storageTierText(this._usage))} · included monthly quota');
});

// ── Theme Switcher & Persistence (Section 80 & 104) ───────────────────
try {
  const savedTheme = localStorage.getItem('antigravity_hub_theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', savedTheme);
    const iconSpan = document.getElementById('themeIcon');
    if (iconSpan) iconSpan.innerHTML = savedTheme === 'dark' ? '${I.moon}' : '${I.sun}';
  }
} catch (e) { console.warn('Cloud Hub: could not restore theme', e); }

function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('antigravity_hub_theme', next); } catch (e) { console.warn('Cloud Hub: could not save theme', e); }
  const iconSpan = document.getElementById('themeIcon');
  if (iconSpan) {
    iconSpan.innerHTML = next === 'dark' ? '${I.moon}' : '${I.sun}';
  }
  showToast('Switched to ' + (next === 'light' ? 'Light' : 'Dark') + ' Mode');
}
${hubUsageScript(this._initialPage)}
document.getElementById('btnThemeToggle').addEventListener('click', toggleTheme);
</script>
</body>
</html>`;
    }
}

module.exports = { DashboardProvider };
