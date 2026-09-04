# Antigravity Codespaces Pro — Complete Audit, Bug Report & Improvement Blueprint

**Repository:** [github.com/Nir-Bhay/antigravity-codespaces](https://github.com/Nir-Bhay/antigravity-codespaces)  
**Marketplace:** [open-vsx.org — nirbhay-hiwse.antigravity-codespaces](https://open-vsx.org/vscode/item?itemName=nirbhay-hiwse.antigravity-codespaces)  
**Audited Version:** `4.3.0` (2393 lines — `extension.js` + `package.json`)  
**Target Version:** `5.0.0` — Robust, Zero-Frustration Multi-Device Architecture  
**Audit Date:** September 2026  
**Audit Type:** Full Line-By-Line Code Review + Internet Research + Multi-Persona UX Analysis

---

> **About This Document**
> This document is the complete, authoritative technical record of every bug, security issue, UX problem, and improvement opportunity discovered in the Antigravity Codespaces Pro extension. It is organized so that each finding can be directly actioned as a code change. It covers: runtime crashes, security vulnerabilities, cross-platform failures, user experience gaps, real-world conditions found through internet research, and a complete architectural redesign blueprint. This document should be used as the primary reference when rebuilding the extension to version 5.0.

---

## Table of Contents

1. [How GitHub Codespaces Actually Works](#1-how-github-codespaces-actually-works)
2. [Full Bug Registry — Critical to Low](#2-full-bug-registry)
3. [Security Audit](#3-security-audit)
4. [User Persona & Real-World Condition Analysis](#4-user-persona--real-world-condition-analysis)
5. [Real-World Problems Found via Internet Research](#5-real-world-problems-found-via-internet-research)
6. [The Full Architecture Blueprint for v5.0](#6-the-full-architecture-blueprint-for-v50)
7. [Complete Code Fixes for Every Bug](#7-complete-code-fixes-for-every-bug)
8. [Feature Improvement Recommendations](#8-feature-improvement-recommendations)
9. [What Not to Do](#9-what-not-to-do)
10. [Pre-Release Verification Checklist](#10-pre-release-verification-checklist)

---

## 1. How GitHub Codespaces Actually Works

Before reviewing bugs, here is what every developer on the extension must fully understand:

### What is a Codespace?
A GitHub Codespace is a **cloud virtual machine (container)** running in Microsoft Azure, provisioned and managed through GitHub's API. When a user opens a Codespace, they get a full Linux environment with VS Code Server running inside it. Users connect to it via SSH tunnel or browser.

### Free Tier Facts (as of 2026)
| Resource | Free Quota (Personal Account) |
|---|---|
| Compute | **120 core hours/month** (= 60 real hours on a 2-core machine) |
| Storage | **15 GB-months/month** |
| Machine Types | 2, 4, 8, 16, 32 vCPU machines |
| Idle Timeout | Default 30 minutes (customizable in GitHub Settings) |

> **Critical UX Note:** Storage is billed even when a Codespace is STOPPED. Deleting unused Codespaces frees storage quota. The extension currently does not explain this at all.

### What Requires a GitHub Account?
**Everything.** GitHub Codespaces is a 100% GitHub-proprietary cloud service. You cannot connect, list, start, or create any Codespace without being authenticated as a valid GitHub user. There is no guest mode. New users **must** create a free GitHub account first.

### The SSH Tunnel Architecture
```
User (Local IDE)
    ↓
~/.ssh/config entry (Host: cs.<name>)
    ↓  ProxyCommand: gh cs ssh -c <name> --stdio
    ↓
GitHub Codespace SSH Gateway (hosted by GitHub)
    ↓
Container running VS Code Server
```
This means:
1. The `gh` CLI is **required** only for SSH tunnel creation.
2. **Listing, starting, stopping, rebuilding, and creating Codespaces do NOT need `gh` CLI** — they can be done via GitHub REST API.
3. The SSH connection requires the Codespace to be in `Available` state AND for the container to have `sshd` running (which is not always true for new containers).

---

## 2. Full Bug Registry

### Severity Legend
- 🔴 **CRITICAL** — Causes immediate crash or complete feature failure for all users
- 🟠 **HIGH** — Breaks a primary workflow in common scenarios
- 🟡 **MEDIUM** — Fails in specific but realistic conditions
- 🔵 **LOW** — Minor degradation, cosmetic issue, or best-practice violation

---

### BUG-01 🔴 CRITICAL — Login Button Crashes Immediately on Clean Systems

**File:** `extension.js:2308–2313`  
**Observed Failure:** Screenshot shows `gh : The term 'gh' is not recognized` in PowerShell.

**What the code does:**
```javascript
// extension.js line 2308-2313
context.subscriptions.push(
    vscode.commands.registerCommand('antigravity-codespaces.loginGitHub', () => {
        const t = vscode.window.createTerminal('GitHub Login');
        t.show();
        t.sendText('gh auth login -s codespace -w');  // ← CRASHES if gh not in PATH
        vscode.window.showInformationMessage('Complete GitHub auth in browser, then click Refresh.');
    })
);
```

**Root cause:** The extension assumes `gh` is installed on every computer. On a clean Windows, macOS, or Linux installation, `gh` is never present. The terminal shows a red error and the user is completely stuck.

**Impact:** 100% of first-time users on clean systems cannot log in.

**Fix:** Use `vscode.authentication.getSession('github', ['repo', 'codespace'], { createIfNone: true })` instead. This uses the IDE's built-in OAuth mechanism — no terminal, no CLI needed.

---

### BUG-02 🔴 CRITICAL — `ANTIGRAVITY_EXE` is Never Declared (ReferenceError)

**File:** `extension.js:2164–2165`

**What the code does:**
```javascript
// extension.js line 2163-2167
// 3. Binary fallback
if (!connected && fs.existsSync(ANTIGRAVITY_EXE)) {  // ← ReferenceError!
    exec(`"${ANTIGRAVITY_EXE}" --folder-uri "vscode-remote://ssh-remote+${hostAlias}${remoteFolder}"`, { windowsHide: true });
    connected = true;
}
```

**Root cause:** The variable `ANTIGRAVITY_EXE` is read on line 2164, but it is **never declared anywhere** in the 2393-line file. There is no `const ANTIGRAVITY_EXE`, `let ANTIGRAVITY_EXE`, or `var ANTIGRAVITY_EXE` anywhere. A helper function `getAntigravityExePath()` exists at line 25 but is never called.

**Impact:** When the direct URI connection (strategy 1) fails AND no remote-SSH extension command is found (strategy 2), the code hits line 2164 and throws:
```
ReferenceError: ANTIGRAVITY_EXE is not defined
```
This kills the entire connect workflow and shows a generic "Connection error" message to the user.

**Fix:**
```javascript
// Add at the top of activate() function
const ANTIGRAVITY_EXE = getAntigravityExePath();
```

---

### BUG-03 🔴 CRITICAL — `GH_PATH` Hardcoded to `'gh'`, Ignores Executable Search

**File:** `extension.js:7` vs `extension.js:11–23`

**What the code does:**
```javascript
const GH_PATH = 'gh';  // ← Line 7: always just 'gh', never changes

function getGhExecutablePath() {  // ← Line 11-23: this function is defined but NEVER USED
    const candidates = [
        'C:\\Program Files\\GitHub CLI\\gh.exe',
        // ... etc
    ];
    // ...
}
```

**Root cause:** `getGhExecutablePath()` was written to solve the PATH issue, but it is **never called to set `GH_PATH`**. So all 17 places in the code that use `GH_PATH` still use the bare string `'gh'`, which depends entirely on the system PATH.

**Impact:** If a user installs GitHub CLI in `C:\Program Files\GitHub CLI\gh.exe` without adding it to their system PATH (which the GitHub CLI installer sometimes doesn't do on older Windows versions), the extension cannot find it even though it's installed.

**Fix:**
```javascript
// Change line 7 from:
const GH_PATH = 'gh';

// To:
const GH_PATH = getGhExecutablePath();  // Uses the smart search function
```

---

### BUG-04 🟠 HIGH — Hardcoded Developer Laptop Path in Production Code

**File:** `extension.js:29`

**What the code does:**
```javascript
function getAntigravityExePath() {
    const candidates = [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
        'C:\\Users\\lenovo\\AppData\\Local\\Programs\\Antigravity IDE\\bin\\antigravity-ide.cmd'  // ← LEFT IN
    ];
```

**Root cause:** A local development machine path with the hardcoded Windows username `lenovo` was left in the production release. This path works only for the developer's personal laptop.

**Impact:** The fallback path is useless on any machine that is not the developer's laptop. It adds confusion and is a professional credibility issue.

**Fix:** Remove the hardcoded path. The `LOCALAPPDATA` + `ProgramFiles` candidates are sufficient. Also add macOS and Linux paths:
```javascript
function getAntigravityExePath() {
    if (process.platform === 'win32') {
        return [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
        ].find(p => p && fs.existsSync(p)) || 'antigravity-ide.cmd';
    } else if (process.platform === 'darwin') {
        return '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide' || 'antigravity-ide';
    }
    return 'antigravity-ide';
}
```

---

### BUG-05 🟠 HIGH — Hardcoded Author's GitHub Username as Fallback

**File:** `extension.js:95`

**What the code does:**
```javascript
function ensureSSHConfigEntry(cs, account) {
    const acc = account || cs.account || 'Nir-Bhay';  // ← PERSONAL USERNAME HARDCODED
```

**Root cause:** If no account can be resolved when writing the SSH config entry, it falls back to the author's personal GitHub handle `Nir-Bhay`. This is likely an artifact from personal testing that was never removed.

**Impact:** On another user's machine, if account resolution fails (e.g., due to BUG-07 below), their `~/.ssh/config` would contain SSH host aliases like `cs-Nir-Bhay-my-project`, which is completely wrong and confusing. SSH connections using these wrong aliases will fail silently.

**Fix:**
```javascript
const acc = (account || cs.account || 'default').replace(/[^a-zA-Z0-9_-]/g, '-');
```

---

### BUG-06 🟠 HIGH — SSH IdentityFile Points to Non-Existent Key

**File:** `extension.js:103`, `extension.js:116`

**What the code does:**
```javascript
const key = path.join(SSH_DIR, 'codespaces.auto');  // ← ~/.ssh/codespaces.auto

const newBlock = `
Host ${exactHost} ${aliasLower} ${aliasExact} ${rawName}
  User codespace
  ProxyCommand "${ghExe}" cs ssh -c ${cs.name} --stdio -- -i "${key}"  // ← key may NOT EXIST
  IdentityFile "${key}"  // ← key may NOT EXIST
`;
```

**Root cause:** The file `~/.ssh/codespaces.auto` is referenced as an SSH private key, but the extension **never generates this key** and never instructs the user to create it. The only way this file would exist is if `gh cs ssh` was run manually first (which automatically generates it). On a fresh system, this file does not exist.

**Impact:** OpenSSH will throw `IdentityFile ~/.ssh/codespaces.auto: No such file or directory` and either fail the connection or print warnings. The `-i` flag in `ProxyCommand` may further confuse `gh cs ssh`.

**Fix:** Remove the `IdentityFile` and `-i` flag from the ProxyCommand entirely. The `gh cs ssh --stdio` command handles SSH key management internally through GitHub's backend — you do not need to specify a key manually:
```
ProxyCommand "${ghExe}" cs ssh -c ${cs.name} --stdio
```

---

### BUG-07 🟠 HIGH — `getAccounts()` Silently Returns Empty on Auth Warnings

**File:** `extension.js:262–278`

**What the code does:**
```javascript
async getAccounts() {
    try {
        const raw = await runCommand(GH_PATH, ['auth', 'status'], 6000);
        // ... parse accounts from 'raw'
    } catch {
        return [];  // ← Silent failure
    }
}
```

**Root cause:** `gh auth status` outputs all diagnostic information to **stderr**, not stdout, and exits with **code 1** if there are any token warnings (e.g., "token has no expiry date" or "missing one scope"). The `runCommand` function rejects the promise on non-zero exit codes, causing the `catch` block to return `[]` — even if the user is fully authenticated. This is a known behavior of the GitHub CLI that trips up many extensions.

**Impact:** A fully authenticated user sees "No GitHub accounts authenticated" and the Login button. This causes massive confusion because they ARE logged in.

**Research-confirmed:** This exact issue is documented in GitHub community forums — users report `gh auth status` returning exit code 1 after token refreshes, causing extensions to think they're not logged in.

**Fix:**
```javascript
async getAccounts() {
    try {
        // gh auth status writes to stderr (exit code 1 on warnings), use both stdout and stderr
        const raw = await new Promise((resolve) => {
            const { exec } = require('child_process');
            exec(`"${GH_PATH}" auth status`, { timeout: 8000 }, (err, stdout, stderr) => {
                // Combine stderr and stdout — status info is in stderr
                resolve((stdout || '') + (stderr || ''));
            });
        });
        const accts = [];
        const re = /Logged in to github\.com account ([A-Za-z0-9_\-]+)/g;
        let m;
        while ((m = re.exec(raw)) !== null) {
            if (!accts.includes(m[1])) accts.push(m[1]);
        }
        // ...
    } catch {
        return [];
    }
}
```

---

### BUG-08 🟠 HIGH — No Cross-Platform Support (macOS/Linux Users Completely Broken)

**File:** `extension.js:11–23` (getGhExecutablePath), `extension.js:25–35` (getAntigravityExePath)

**What the code does:**
```javascript
function getGhExecutablePath() {
    const candidates = [
        'C:\\Program Files\\GitHub CLI\\gh.exe',              // Windows only
        path.join(process.env.ProgramFiles, 'GitHub CLI', 'gh.exe'),  // Windows only
        path.join(process.env['ProgramFiles(x86)'], '...'),    // Windows only
        path.join(process.env.LOCALAPPDATA, '...'),            // Windows only
        path.join(os.homedir(), 'scoop', 'shims', 'gh.exe')   // Windows Scoop only
    ];
    // No macOS paths. No Linux paths.
    return 'gh.exe';  // Falls back to Windows-specific binary name
}
```

**Root cause:** Zero Linux or macOS paths are checked. On a Mac with `brew install gh`, the binary is at `/opt/homebrew/bin/gh`. On Ubuntu, it's at `/usr/bin/gh`. Both would fail the candidate check and fall back to `'gh.exe'` — which doesn't even exist on non-Windows.

**Impact:** The extension is listed on Open-VSX, which is the primary extension marketplace for Code-OSS and any Linux-based IDE. All Linux users and macOS users who do not have `gh` in their system PATH are completely broken.

**Fix:**
```javascript
function getGhExecutablePath() {
    const platform = process.platform;

    // Try system PATH first (most reliable)
    try {
        const checkCmd = platform === 'win32' ? 'where.exe gh 2>nul' : 'which gh 2>/dev/null';
        const result = require('child_process').execSync(checkCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        const firstPath = result.split(/\r?\n/)[0].trim();
        if (firstPath && fs.existsSync(firstPath)) return firstPath;
    } catch {}

    // Platform-specific fallback candidates
    if (platform === 'win32') {
        const winCandidates = [
            'C:\\Program Files\\GitHub CLI\\gh.exe',
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'),
            path.join(process.env['ProgramFiles(x86)'] || '', 'GitHub CLI', 'gh.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe'),
            path.join(os.homedir(), 'scoop', 'shims', 'gh.exe'),
            'C:\\ProgramData\\chocolatey\\bin\\gh.exe'  // Chocolatey
        ];
        for (const p of winCandidates) {
            if (p && fs.existsSync(p)) return p;
        }
        return 'gh.exe';
    } else if (platform === 'darwin') {
        const macCandidates = [
            '/opt/homebrew/bin/gh',        // Homebrew on Apple Silicon
            '/usr/local/bin/gh',           // Homebrew on Intel
            path.join(os.homedir(), '.local/bin/gh')
        ];
        for (const p of macCandidates) {
            if (p && fs.existsSync(p)) return p;
        }
        return 'gh';
    } else {
        // Linux
        const linuxCandidates = [
            '/usr/bin/gh',
            '/usr/local/bin/gh',
            '/snap/bin/gh',
            path.join(os.homedir(), '.local/bin/gh')
        ];
        for (const p of linuxCandidates) {
            if (p && fs.existsSync(p)) return p;
        }
        return 'gh';
    }
}
```

---

### BUG-09 🟡 MEDIUM — Token Cache Never Invalidated After Logout or Account Switch

**File:** `extension.js:38` (`tokenCache` at module level)

**What the code does:**
```javascript
const tokenCache = new Map();  // ← global cache, lives until IDE restart

async function getAccountToken(account) {
    if (tokenCache.has(account)) return tokenCache.get(account);  // Always returns cached value
    // ...
}
```

**Root cause:** The `tokenCache` is a module-level `Map` that is never cleared. When a user logs out or switches accounts via `gh auth switch`, the old token remains in the cache. The extension keeps using an expired or wrong token until the IDE is fully restarted.

**Impact:** Actions taken after switching accounts may silently operate on the wrong account's data (e.g., fetching Codespaces for account A after the user switched to account B).

**Also missing:** `tokenCache.clear()` is absent from the `refresh()` method (only `csCache`, `metaCache`, and `portsCache` are cleared on line 256–258).

**Fix:**
```javascript
async refresh() {
    this.csCache.clear();
    this.metaCache.clear();
    this.portsCache.clear();
    tokenCache.clear();  // ← ADD THIS LINE
    await this.render();
}
```
And invalidate the token cache in the `loginGitHub` and `switchAccount` command handlers.

---

### BUG-10 🟡 MEDIUM — Waking a Stopped Codespace Uses CLI SSH (Slow & Fragile)

**File:** `extension.js:2199`

**What the code does:**
```javascript
// "Start" command
await runCommand(GH_PATH, ['cs', 'ssh', '-c', cs.name, '--', 'echo', 'up'], 30000, envOpts);
```

**Root cause:** To wake a stopped Codespace, the extension opens an SSH tunnel and runs `echo up` over it. This is an extremely slow and fragile way to start a Codespace. It requires `gh` to be installed, requires the SSH server to be running inside the container, and takes 30+ seconds just to verify the connection is up.

**Impact:** Users experience slow start times (up to 30 seconds of waiting) when waking a stopped Codespace. If `gh` isn't installed, the start command fails entirely.

**Better approach:** Use the GitHub REST API:
```
POST https://api.github.com/user/codespaces/{codespace_name}/start
```
This is instantaneous to call, doesn't require `gh` CLI, and returns the new state immediately.

---

### BUG-11 🟡 MEDIUM — No `onDidChangeConfiguration` Listener — Settings Changes Ignored

**File:** `extension.js` (entire file — 0 occurrences of `onDidChangeConfiguration`)

**Root cause:** The extension reads configuration settings (`showStatusBarItem`, `serverAliveInterval`, `serverAliveCountMax`, `autoSyncSSHOnStartup`) only once during activation. VS Code fires `vscode.workspace.onDidChangeConfiguration` when users change these settings in the IDE's preferences panel, but this event is never listened to.

**Impact:**
- User toggles "Show Status Bar Item" → Status bar doesn't change until IDE restart
- User changes SSH keepalive interval → Old value still used in SSH config
- Poor IDE integration experience

**Fix:**
```javascript
// Add inside activate()
context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('antigravity-codespaces.showStatusBarItem')) {
            const cfg = vscode.workspace.getConfiguration('antigravity-codespaces');
            cfg.get('showStatusBarItem', true) ? statusBarItem.show() : statusBarItem.hide();
        }
        if (e.affectsConfiguration('antigravity-codespaces.serverAliveInterval') ||
            e.affectsConfiguration('antigravity-codespaces.serverAliveCountMax')) {
            // Re-sync SSH config with new keepalive values
            sidebarProvider.refresh();
        }
    })
);
```

---

### BUG-12 🟡 MEDIUM — `deactivate()` Does Nothing — Memory Leak on Extension Reload

**File:** `extension.js:2390`

**What the code does:**
```javascript
function deactivate() {}
```

**Root cause:** When VS Code unloads the extension (on reload, update, or disable), `deactivate()` is called. The current empty implementation means:
- The `tokenCache` Map is not cleared
- Any pending `setTimeout` callbacks from operations like `setTimeout(() => this.refresh(), 2500)` are not cancelled
- No graceful cleanup of state

**Impact:** When the extension is reloaded (e.g., during development or after an update), stale state from the previous activation cycle may leak. This is especially important because `retainContextWhenHidden: true` is used on both webviews.

**Fix:**
```javascript
function deactivate() {
    tokenCache.clear();
    // Clear any pending timers if references are stored globally
    console.log('Antigravity Codespaces: deactivated and cleaned up.');
}
```

---

### BUG-13 🟡 MEDIUM — Race Condition: `isConnecting` Lock Never Released on Error

**File:** `extension.js:2099–2184`

**What the code does:**
```javascript
// connect command
if (isConnecting) {
    vscode.window.showInformationMessage('Connection already in progress...');
    return;
}
isConnecting = true;

try {
    // ... connection logic
} catch (e) {
    vscode.window.showErrorMessage(`Connection error: ${e.message}`);
} finally {
    isConnecting = false;
}
```

**Status:** The `finally` block is correctly present, so `isConnecting` IS released. However, the lock is a **module-level variable** — if two different connect commands fire before either completes (which is possible via the sidebar AND the dashboard simultaneously calling the command), only one will proceed. The second one shows "already in progress" even if they're connecting to different Codespaces.

**Fix:** Use a `Set` of currently-connecting Codespace names instead of a single boolean lock:
```javascript
const connectingSet = new Set();

// In connect command:
if (connectingSet.has(cs.name)) {
    vscode.window.showInformationMessage(`Already connecting to ${cs.displayName || cs.name}...`);
    return;
}
connectingSet.add(cs.name);
try { /* ... */ } finally { connectingSet.delete(cs.name); }
```

---

### BUG-14 🟡 MEDIUM — Quick Actions Menu Missing Login Option When Not Authenticated

**File:** `extension.js:1924–1948`

**What the code does:**
```javascript
const picks = [
    { label: '$(play) Quick Connect to Codespace...', action: 'quickConnect', ... },
    { label: '$(layout-sidebar-left) Open Cloud Hub Dashboard', action: 'dashboard', ... },
    { label: '$(account) Switch Active GitHub Account', action: 'switchAccount', ... },
    // ... etc
];
// There is NO login option in this menu
```

**Root cause:** If a user closes the sidebar and only has access to the status bar item, clicking it opens the Quick Actions menu. But this menu has no login option. A user without any authenticated accounts would select any item and get a confusing "No GitHub accounts found. Run: gh auth login..." warning.

**Fix:** Check authentication status before showing the menu. If no accounts exist, show a simplified menu with only the Login option.

---

### BUG-15 🔵 LOW — Multiple `acquireVsCodeApi()` Calls in Same Webview

**File:** `extension.js:364` (sidebar) and `extension.js:728` (sidebar script)

**What the code does:**
In the sidebar's `buildNoAuthHtml()` function (line 364):
```javascript
<button onclick="acquireVsCodeApi().postMessage({command:'loginGitHub'})">Login to GitHub</button>
```
And in the sidebar's `buildSidebarHtml()` function (line 728):
```javascript
const vscode = acquireVsCodeApi();
```

**Root cause:** The `buildNoAuthHtml()` function creates an HTML page that calls `acquireVsCodeApi()` inline in an onclick handler. The `buildSidebarHtml()` creates a different page that also calls it. Each page should only call it once.

**Specific issue with the no-auth view:** The `onclick="acquireVsCodeApi().postMessage(...)"` pattern calls `acquireVsCodeApi()` on every button click rather than storing it once. While VS Code currently handles this, it is explicitly documented as a violation of the API contract and creates a security surface where a hypothetical injected script could hijack the API state.

**Fix:** In `buildNoAuthHtml()`:
```html
<script>
const vscode = acquireVsCodeApi();  // Store once
</script>
<button onclick="vscode.postMessage({command:'loginGitHub'})">Login to GitHub</button>
```

---

### BUG-16 🔵 LOW — `ref` field from `gitStatus` Not Always Available; Falls Back Silently

**File:** `extension.js:373`, `extension.js:828`

**What the code does:**
```javascript
const branch = cs.gitStatus?.ref || 'main';  // Assumes 'main' if undefined
```

**Root cause:** The `gitStatus.ref` field represents the current branch. If a user's default branch is `master`, `develop`, or any other name, the display incorrectly shows `main` for stopped Codespaces that haven't recently synced their metadata.

**Impact:** Minor misleading UI — branch shows "main" when the actual branch may be different.

**Fix:** Use `'unknown'` or an empty string as fallback and display a dash:
```javascript
const branch = cs.gitStatus?.ref || cs.gitStatus?.head || '—';
```

---

## 3. Security Audit

### SEC-01 🔴 CRITICAL — Complete Absence of Content Security Policy (CSP)

**Files:** `buildNoAuthHtml()` (L351), `buildSidebarHtml()` (L370), `buildDashboardHtml()` (L801)

**What is missing:**
A Content Security Policy (CSP) `<meta>` tag is absent from ALL THREE webviews in the extension. The VS Code extension documentation explicitly states CSP is mandatory and provides specific guidance on using nonces.

**Risk:** Without a CSP:
- If any piece of user data rendered into the HTML (e.g., a Codespace display name containing `<script>alert(1)</script>`) is not escaped, it executes as JavaScript inside the extension
- A compromised dependency or malicious HTML in a fetched resource could execute arbitrary code with the extension's privileges

**Example of what an attacker's Codespace display name could do:**
If a user is connected to a shared GitHub organization and someone names their Codespace: `"><img src=x onerror="vscode.postMessage({command:'deleteCodespace',name:'victim-name'})">`, it could trigger destructive actions.

**Fix:** Add CSP headers with nonce to all three webview HTML generators:
```javascript
// Generate a cryptographically random nonce for each render
function generateNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}

// In every webview HTML template:
const nonce = generateNonce();
// Add to <head>:
`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}' 'unsafe-inline';">`
// Apply nonce to <script> tags:
`<script nonce="${nonce}">...`
```

---

### SEC-02 🟠 HIGH — User-Controlled Data Injected into innerHTML Without Sanitization

**File:** `extension.js:781–791` (sidebar meta expand section)

**What the code does:**
```javascript
inner.innerHTML = `
    <div class="meta-line">${spec}${loc}</div>
    ...
`;
```

Where `spec` comes from `meta.machineDisplayName || meta.machineName || '2 vCPU, 8 GB RAM'` — data fetched from GitHub's API about a Codespace that was potentially named by another user in a shared organization.

**Risk:** If GitHub's API returns machine spec data with unexpected characters, or if this is somehow tampered with in a MITM scenario, it could execute arbitrary HTML.

**Fix:** Always escape HTML entities for dynamic data:
```javascript
function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
// Then:
inner.innerHTML = `<div class="meta-line">${escapeHtml(spec)}${escapeHtml(loc)}</div>`;
```

---

### SEC-03 🟠 HIGH — No Token Secure Storage — Tokens Only in Memory

**Current state:** Tokens obtained from `gh auth token` are stored in `tokenCache` (a plain JavaScript `Map` in process memory). There is no use of VS Code's `context.secrets` API.

**Risk:** 
- On process crash or leak, tokens could potentially be exposed
- No ability to store a user-provided PAT between IDE restarts (it would be lost)
- No ability for the user to revoke a stored token from within the extension

**Fix:** Use `context.secrets.store()` for any PAT provided by the user:
```javascript
// Storing a PAT
await context.secrets.store('github_pat', userProvidedPat);

// Retrieving it
const storedPat = await context.secrets.get('github_pat');
```

---

### SEC-04 🔵 LOW — `onDidReceiveMessage` Does Not Validate Command Payloads

**File:** `extension.js:178–249` (sidebar), `extension.js:1757–1820` (dashboard)

**Root cause:** Every message received from the webview is immediately acted upon without validating the shape or content of the data. For example:
```javascript
case 'connect':
    await vscode.commands.executeCommand('antigravity-codespaces.connect', {
        codespaceData: { name: msg.name, account: msg.account, repository: msg.repo }
    });
```
There is no check that `msg.name` is a valid string, that it doesn't contain path traversal characters, or that it corresponds to a legitimate Codespace.

**Fix:** Add basic input validation:
```javascript
case 'connect':
    if (typeof msg.name !== 'string' || msg.name.length > 200 || !/^[\w.-]+$/.test(msg.name)) {
        console.warn('Invalid codespace name received:', msg.name);
        break;
    }
    await vscode.commands.executeCommand('antigravity-codespaces.connect', {
        codespaceData: { name: msg.name, account: msg.account, repository: msg.repo }
    });
```

---

## 4. User Persona & Real-World Condition Analysis

### Persona 1: The Complete Beginner
**Profile:** Student or new developer. Never heard of Codespaces. No GitHub account. No GitHub CLI. First time using any cloud IDE.

**Current journey with v4.3.0:**
1. Installs extension from Open-VSX
2. Sees small sidebar with "No GitHub accounts authenticated." and a "Login to GitHub" button
3. Clicks the button
4. A terminal pops open with red text: `'gh' is not recognized...`
5. Has no idea what happened. Thinks the extension is broken. Uninstalls.
6. Never uses GitHub Codespaces.

**Required journey with v5.0:**
1. Installs extension from Open-VSX
2. Sees a welcoming Welcome Hub with explanation: *"GitHub Codespaces gives you a full cloud development environment. Free tier: 60 hours/month."*
3. Sees "Don't have a GitHub account? Create one free →" link
4. Creates account, clicks "Sign In with GitHub"
5. IDE native dialog opens → browser opens → user approves → returns to IDE
6. Dashboard loads showing empty Codespaces list with "Create Your First Codespace" button
7. Success.

---

### Persona 2: The Experienced Developer (Has GitHub, No CLI)
**Profile:** Mid-level developer, uses GitHub daily via browser and VS Code Git integration. Never installed GitHub CLI.

**Current journey:**
1. Installs extension
2. Clicks "Login to GitHub"
3. Gets terminal error: `'gh' is not recognized`
4. Frustration: "I literally have a GitHub account"
5. Has to Google "GitHub CLI install", install it, re-authenticate, THEN the extension works.

**Required journey:**
1. Installs extension
2. Clicks "Sign In with GitHub" (native VS Code OAuth button)
3. Browser confirms GitHub permissions for `repo` and `codespace` scopes
4. Codespaces dashboard loads immediately
5. Can list, start, stop, and manage Codespaces without EVER installing `gh` CLI
6. Only when clicking "Connect" (SSH tunnel) does the extension check for `gh` and offer an install button if missing

---

### Persona 3: The macOS Developer
**Profile:** Developer using Antigravity IDE or Code-OSS on macOS. Has `gh` installed via Homebrew at `/opt/homebrew/bin/gh`.

**Current journey:**
1. Installs extension
2. Clicks "Login to GitHub"
3. Terminal runs: `gh auth login -s codespace -w` and... it might work or fail depending on whether `/opt/homebrew/bin` is in the PATH
4. Even if login works, `GH_PATH = 'gh'` may fail on subsequent API calls if the PATH is not set correctly in the Node.js child process environment (Node does not always inherit the user's interactive shell PATH on macOS)

**Required journey:**
1. Installs extension
2. Native OAuth — no CLI needed for login
3. REST API — no CLI needed for dashboard
4. SSH connect — explicitly detects `/opt/homebrew/bin/gh` even without PATH

---

### Persona 4: The Corporate/University User
**Profile:** Developer inside a corporate network. The IT firewall:
- Blocks `localhost` OAuth redirects
- Blocks port 8080 callbacks
- Requires traffic through an HTTP proxy

**Current journey:**
1. Login via terminal: `gh auth login -s codespace -w`
2. Browser opens, waits for OAuth callback to `http://localhost:xxxx`
3. Firewall blocks the callback redirect
4. Authentication hangs or times out
5. User is completely stuck with no alternative offered

**Required journey:**
1. Two login options presented:
   - "Sign In with GitHub" (standard OAuth)
   - "Use Personal Access Token (PAT)" — for environments where OAuth cannot complete
2. PAT login uses `context.secrets` for secure encrypted storage
3. Subsequent API calls use the stored PAT

---

### Persona 5: The Multi-Account Power User
**Profile:** Uses personal GitHub account AND a work organization account. Wants to manage Codespaces from both.

**Current journey:**
1. Logs in with personal account → works
2. `switchAccount` command → shows accounts → `gh auth switch` runs → works
3. However: if the user logged in with the extension's native OAuth (v5.0 scenario), each account needs separate OAuth session handling

**Required journey:**
1. Extension detects both authenticated sessions via `vscode.authentication`
2. Side-by-side account chips in the dashboard
3. Account-aware Codespace listing works without `gh auth switch`

---

### Persona 6: The Clean Machine (Friend's Computer)
**Profile:** Borrowed a computer, or testing on a friend's computer. Nothing pre-installed. This is the exact scenario that triggered this audit.

**Exact failure from screenshot:**
```
PS C:\Users\abhay> gh auth login -s codespace -w
gh : The term 'gh' is not recognized as the name of a cmdlet, function, script
file, or operable program. Check the spelling of the name, or verify that the
path is correct and try again.
```

**Required v5.0 fix:** All of BUG-01 through BUG-08 addressed, plus native OAuth for login with zero terminal dependency.

---

## 5. Real-World Problems Found via Internet Research

The following issues were discovered through researching GitHub community forums, Stack Overflow, VS Code GitHub issues, and extension development documentation:

### R-01: `gh auth status` Exits with Code 1 Even When Authenticated
**Source:** GitHub CLI known behavior, GitHub Community forums  
**Description:** `gh auth status` always writes output to **stderr** and may exit with code 1 if the token has any advisory warnings (e.g., "token stored in plain text" on Linux). The extension's `getAccounts()` function rejects the promise when this happens and returns `[]`.  
**Impact:** Users who are fully authenticated see "No GitHub accounts" after normal `gh` operations that trigger warnings.  
**Fix:** Capture both stdout and stderr from `gh auth status`, and parse both.

### R-02: SSH Not Auto-Installed in New Codespaces
**Source:** GitHub Codespaces changelog  
**Description:** Recent Codespace container images do not automatically install SSH Server (`sshd`). New containers require explicitly adding the sshd Dev Container Feature in `.devcontainer/devcontainer.json`. Without it, `gh cs ssh` connects but immediately closes.  
**Impact:** Users creating Codespaces from new repositories get confusing "connection closed" errors when trying to SSH connect.  
**Recommended action:** When an SSH connection fails, display an informative message: *"If this is a new Codespace, SSH may not be configured. Add the SSHD feature to your devcontainer.json. [Learn More]"*

### R-03: Corporate Firewall Blocks OAuth Localhost Callback
**Source:** Common enterprise VS Code setup guides  
**Description:** Many corporate networks block `http://localhost` callbacks used by GitHub CLI's device flow auth. The `-w` (web browser) flow requires localhost to receive the OAuth token.  
**Impact:** Enterprise users stuck at login.  
**Fix:** Offer PAT login as an alternative.

### R-04: Idle Timeout Confusion Causing User Frustration
**Source:** GitHub Community, Stack Overflow  
**Description:** Users frequently lose work because their Codespace auto-stopped after 30 minutes of inactivity. They don't understand why the connection drops. The extension has no UI to show the idle timeout setting or warn the user that the Codespace is about to stop.  
**Recommended feature:** Add a tooltip or warning when a Codespace has been idle for >20 minutes: *"⚠️ This Codespace will auto-stop in 10 minutes (idle timeout: 30m). [Keep Alive]"*

### R-05: Storage Quota Exhaustion Traps Users
**Source:** Stack Overflow, GitHub Community  
**Description:** Users hit their 15 GB storage limit from old/prebuilt Codespaces but see no clear explanation. The extension shows no storage usage. Users get confused errors when trying to create new Codespaces.  
**Recommended feature:** Add a storage quota indicator in the dashboard and a link to GitHub's Billing settings.

### R-06: `remote.extensionKind` Setting Breaks Authentication
**Source:** VS Code GitHub issues  
**Description:** Some users have `remote.extensionKind: { "vscode.github-authentication": ["workspace"] }` in their `settings.json` (often set by a tutorial or corporate policy). This forces GitHub auth to run on the remote side, breaking it entirely.  
**Recommended action:** On auth failure, add diagnostic check for this setting and suggest removing it.

### R-07: Multiple Sessions with `vscode.authentication.getSession`
**Source:** VS Code API docs (2024), GitHub extension examples  
**Description:** `vscode.authentication.getSession` returns only one session per provider. For multi-account support, the extension must handle `vscode.authentication.onDidChangeSessions` and track multiple sessions separately.  
**Impact:** With native OAuth, only ONE GitHub account would be detected unless handled specially.

---

## 6. The Full Architecture Blueprint for v5.0

### Core Principle: Zero CLI Dependency for All Non-SSH Operations

```
┌─────────────────────────────────────────────────────────────────┐
│                    TIER 1: AUTHENTICATION                       │
│                                                                 │
│  Primary: vscode.authentication.getSession('github', scopes)    │
│  Fallback A: context.secrets PAT (secure storage)              │
│  Fallback B: gh CLI token (if installed)                        │
└────────────────────────┬────────────────────────────────────────┘
                         │ OAuth Token / PAT
┌────────────────────────▼────────────────────────────────────────┐
│               TIER 2: REST API ENGINE (No CLI)                  │
│                                                                 │
│  List Codespaces   → GET  /user/codespaces                      │
│  Start Codespace   → POST /user/codespaces/{name}/start         │
│  Stop Codespace    → POST /user/codespaces/{name}/stop          │
│  Delete Codespace  → DELETE /user/codespaces/{name}             │
│  Create Codespace  → POST /user/codespaces                      │
│  List Repos        → GET  /user/repos                           │
│  User Info         → GET  /user                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │ (Only for Connect)
┌────────────────────────▼────────────────────────────────────────┐
│               TIER 3: SSH TUNNEL (CLI Required)                 │
│                                                                 │
│  Prerequisite check → Is gh CLI installed?                      │
│    Yes → Generate SSH config, open remote window                │
│    No  → Prompt: "Install GitHub CLI to enable SSH connect"     │
│           [Install via winget] [Install via brew] [Download]    │
└─────────────────────────────────────────────────────────────────┘
```

### New File Structure for v5.0 (Split Single File)

```
extension.js          ← Entry point (activate/deactivate only)
src/
  authManager.js      ← All authentication logic
  githubApi.js        ← All REST API calls
  systemDoctor.js     ← Prerequisite checker (gh CLI, SSH ext, platform)
  sshManager.js       ← SSH config generation, ProxyCommand fixes
  sidebarProvider.js  ← Sidebar webview
  dashboardProvider.js← Dashboard webview
  statusBar.js        ← Status bar management
  utils.js            ← Helpers (escapeHtml, formatRelativeTime, etc.)
```

---

## 7. Complete Code Fixes for Every Bug

### Fix for BUG-01 + BUG-03 + BUG-07 — Complete Login Rewrite

```javascript
// Replace the loginGitHub command handler entirely:
context.subscriptions.push(
    vscode.commands.registerCommand('antigravity-codespaces.loginGitHub', async () => {
        try {
            // 1. Try VS Code Native OAuth (no terminal, no CLI required)
            const session = await vscode.authentication.getSession(
                'github',
                ['repo', 'codespace', 'user'],
                { createIfNone: true }
            );
            if (session) {
                vscode.window.showInformationMessage(
                    `✅ Signed in as ${session.account.label}. Loading your Codespaces...`
                );
                sidebarProvider.nativeToken = session.accessToken;
                sidebarProvider.nativeUser = session.account.label;
                await sidebarProvider.refresh();
                await updateStatusBar();
                return;
            }
        } catch (oauthErr) {
            // OAuth was cancelled or failed — offer PAT fallback
            console.warn('Native OAuth failed:', oauthErr.message);
        }

        // 2. Offer PAT fallback (for corporate/proxy environments)
        const choice = await vscode.window.showWarningMessage(
            'GitHub sign-in was not completed. You can also sign in using a Personal Access Token (PAT).',
            'Enter PAT',
            'Try Again'
        );
        if (choice === 'Try Again') {
            vscode.commands.executeCommand('antigravity-codespaces.loginGitHub');
        } else if (choice === 'Enter PAT') {
            const pat = await vscode.window.showInputBox({
                prompt: 'Enter your GitHub Personal Access Token',
                placeHolder: 'ghp_...',
                password: true,
                ignoreFocusOut: true,
                validateInput: t => (t && t.startsWith('ghp_') || t.startsWith('github_pat_')) ? null : 'Token should start with ghp_ or github_pat_'
            });
            if (pat) {
                await context.secrets.store('antigravity_github_pat', pat.trim());
                sidebarProvider.nativeToken = pat.trim();
                await sidebarProvider.refresh();
                vscode.window.showInformationMessage('PAT saved securely. Loading Codespaces...');
            }
        }
    })
);
```

---

### Fix for BUG-02 — Declare ANTIGRAVITY_EXE

```javascript
// In activate(), after sidebarProvider is created, add:
const ANTIGRAVITY_EXE = getAntigravityExePath();
```

---

### Fix for BUG-06 — Corrected ensureSSHConfigEntry

```javascript
function ensureSSHConfigEntry(cs, account) {
    try {
        if (!fs.existsSync(SSH_DIR)) fs.mkdirSync(SSH_DIR, { recursive: true });
        
        // No hardcoded author fallback
        const acc = (account || cs.account || 'default').replace(/[^a-zA-Z0-9_-]/g, '-');
        const repoShort = ((cs.repository || cs.name).split('/').pop() || 'workspace').replace(/[^a-zA-Z0-9_-]/g, '-');
        const aliasLower = `cs-${acc}-${repoShort}`.toLowerCase();
        const exactHost = `cs.${cs.name}`;

        const ghExe = GH_PATH;  // Now correctly resolved via getGhExecutablePath()

        let cfg = fs.existsSync(SSH_CONFIG_PATH) ? fs.readFileSync(SSH_CONFIG_PATH, 'utf8') : '';
        const blockId = `# CS_ENTRY:${cs.name}`;

        const config = vscode.workspace.getConfiguration('antigravity-codespaces');
        const aliveInterval = config.get('serverAliveInterval', 30);
        const aliveMax = config.get('serverAliveCountMax', 10);

        // NO IdentityFile / -i flag: gh cs ssh manages keys internally
        const newBlock = `
${blockId}
Host ${exactHost} ${aliasLower} ${cs.name}
  User codespace
  ProxyCommand "${ghExe}" cs ssh -c ${cs.name} --stdio
  UserKnownHostsFile /dev/null
  StrictHostKeyChecking no
  LogLevel quiet
  ServerAliveInterval ${aliveInterval}
  ServerAliveCountMax ${aliveMax}
  TCPKeepAlive yes
`;
        if (cfg.includes(blockId)) {
            const regex = new RegExp(`\\n*${blockId}[\\s\\S]*?TCPKeepAlive yes`, 'g');
            cfg = cfg.replace(regex, '');
        }
        cfg = cfg.trim() + '\n' + newBlock.trim() + '\n';
        fs.writeFileSync(SSH_CONFIG_PATH, cfg, 'utf8');
        return exactHost;
    } catch (e) {
        console.error('SSH config error:', e);
        return `cs.${cs.name}`;
    }
}
```

---

### Fix for BUG-10 — REST API Start Instead of SSH Ping

```javascript
// Replace start command with REST API call:
vscode.commands.registerCommand('antigravity-codespaces.start', async (item) => {
    const cs = item?.codespaceData;
    if (!cs) return;
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Starting ${cs.displayName || cs.name}...`, cancellable: false },
        async () => {
            try {
                const token = await getAccountToken(cs.account);
                if (token) {
                    // Use REST API — instant, no CLI needed
                    const res = await fetch(`https://api.github.com/user/codespaces/${encodeURIComponent(cs.name)}/start`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Accept': 'application/vnd.github+json',
                            'X-GitHub-Api-Version': '2022-11-28'
                        }
                    });
                    if (res.ok || res.status === 409) {  // 409 = already running
                        vscode.window.showInformationMessage(`${cs.displayName || cs.name} is starting...`);
                    } else {
                        throw new Error(`HTTP ${res.status}`);
                    }
                } else {
                    // CLI fallback
                    await runCommand(GH_PATH, ['codespace', 'stop', '--codespace', cs.name], 30000);
                }
                sidebarProvider.refresh();
                await updateStatusBar();
            } catch (e) {
                vscode.window.showErrorMessage(`Could not start: ${e.message}`);
            }
        }
    );
})
```

---

## 8. Feature Improvement Recommendations

### FR-01: Smart Onboarding Welcome Screen
**Priority: HIGH**  
Replace the current 3-line `buildNoAuthHtml()` with a proper welcome screen that:
- Explains what Codespaces is in 1–2 sentences
- Shows the free tier (60 hours/month for 2-core)
- Provides "Create Free GitHub Account →" link
- Shows "Sign In with GitHub" as primary button
- Shows "Use Personal Access Token" as secondary option
- Displays a simple system health checklist (SSH Extension, GitHub CLI) with traffic light indicators

---

### FR-02: Storage Quota Awareness
**Priority: MEDIUM**  
Add to the Dashboard header:
- `GET https://api.github.com/user/codespaces` returns storage info
- Show a compact "Storage: 3.2 GB / 15 GB" indicator
- Warning when >80% used: "⚠️ You're using 13 GB of your 15 GB free storage. Delete unused Codespaces to avoid quota issues."
- Link to `https://github.com/settings/billing`

---

### FR-03: Idle Timeout Warning & Keep-Alive
**Priority: MEDIUM**  
- Show idle timeout remaining on running Codespace cards
- Offer "Keep Alive" button that pings `gh cs ssh -c <name> -- echo ping` to reset the 30-minute timer
- Or display: *"This Codespace auto-stops after 30 minutes of inactivity. [Change in GitHub Settings →]"*

---

### FR-04: SSH Not Configured Warning
**Priority: HIGH**  
When `gh cs ssh` fails with "connection closed immediately", detect the pattern and display:
```
SSH connection closed immediately. This Codespace may not have SSH Server configured.
Add this to your .devcontainer/devcontainer.json:
    "features": { "ghcr.io/devcontainers/features/sshd:1": {} }
Then rebuild the container.
[Open devcontainer docs] [Try SSH anyway]
```

---

### FR-05: Remote SSH Extension Prerequisite Check
**Priority: HIGH**  
Before attempting `vscode.openFolder('vscode-remote://ssh-remote+...')`, check:
```javascript
const allExtensions = vscode.extensions.all;
const hasRemoteSsh = allExtensions.some(e =>
    ['ms-vscode-remote.remote-ssh', 'jeanp413.open-remote-ssh', 'opencodespace.opencodespace'].includes(e.id)
);
if (!hasRemoteSsh) {
    const install = await vscode.window.showWarningMessage(
        'Opening a remote workspace requires an SSH Remote extension. Would you like to install one?',
        'Install Open Remote - SSH',
        'Use Terminal SSH Instead'
    );
    if (install === 'Install Open Remote - SSH') {
        vscode.commands.executeCommand('workbench.extensions.search', 'open-remote-ssh');
    }
}
```

---

### FR-06: GitHub CLI Auto-Install Prompt
**Priority: HIGH**  
When `gh` CLI is not found and SSH connect is attempted:
```javascript
async function promptInstallGhCli() {
    const platform = process.platform;
    const options = [];
    if (platform === 'win32') options.push('Install with winget');
    if (platform === 'darwin') options.push('Install with Homebrew');
    options.push('Download from cli.github.com');

    const choice = await vscode.window.showInformationMessage(
        'GitHub CLI (gh) is needed to open SSH connections to Codespaces. Install it to continue.',
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
    } else if (choice?.includes('cli.github.com')) {
        vscode.env.openExternal(vscode.Uri.parse('https://cli.github.com'));
    }
}
```

---

### FR-07: Auto-Refresh on Token Change
**Priority: MEDIUM**  
```javascript
// In activate():
context.subscriptions.push(
    vscode.authentication.onDidChangeSessions(e => {
        if (e.provider.id === 'github') {
            tokenCache.clear();
            sidebarProvider.refresh();
            updateStatusBar();
        }
    })
);
```

---

### FR-08: Better Error Messages (Replace Raw Errors)

Current error messages expose raw CLI stderr to users:
```
"Connection error: Timed out (15s): gh cs ssh -c nice-garbanzo-1abc23def..."
```

Replace with friendly messages:
```javascript
function friendlyError(err) {
    const msg = err.message || '';
    if (msg.includes('Timed out')) return 'Connection timed out. The Codespace may be starting up — try again in a moment.';
    if (msg.includes('not recognized')) return 'GitHub CLI (gh) is not installed. Install it to enable SSH connections.';
    if (msg.includes('authentication')) return 'Authentication expired. Please sign in again.';
    if (msg.includes('not found') || msg.includes('404')) return 'Codespace not found. It may have been deleted.';
    if (msg.includes('billing')) return 'Billing limit reached. Check your GitHub billing settings.';
    return msg;
}
```

---

## 9. What NOT to Do

### ❌ DO NOT: Keep `gh auth login` Terminal Popup as Primary Login
Users should never have to type CLI commands to use a GUI extension. The terminal popup breaks trust, fails on clean systems, and provides terrible UX. The VS Code native OAuth or PAT flow should always be the primary path.

### ❌ DO NOT: Hardcode Any Developer Names, Paths, or Usernames
Any string like `'Nir-Bhay'`, `'C:\Users\lenovo\...'`, or any personal path must be removed before publishing. These are embarrassing and break functionality on other machines.

### ❌ DO NOT: Publish Without Content Security Policy in All Webviews
Without CSP, the extension is vulnerable to XSS from user-controlled data (Codespace names, display names, repository names). CSP with nonces is required and is a 20-line addition.

### ❌ DO NOT: Store Tokens in Plain JavaScript Objects
Use `context.secrets` for any long-lived token storage. Plain object caches are fine for session-level caching but must never be written to disk or used for persistent PAT storage.

### ❌ DO NOT: Show Raw SSH/CLI Error Messages to Users
Lines like `"Timed out (15s): gh cs ssh -c <name>..."` are meaningless to normal users. Always wrap errors in friendly, actionable messages.

### ❌ DO NOT: Assume All Users Have SSH Server in Their Codespace
SSH is not pre-installed in all container images. Always handle SSH connection failures gracefully and explain the devcontainer.json fix.

### ❌ DO NOT: Use `getSession` Without Handling the Multi-Account Case
The `vscode.authentication.getSession` API returns one session. For multi-account support, maintain a separate Set of known user tokens using `onDidChangeSessions` events.

---

## 10. Pre-Release Verification Checklist

Before publishing v5.0, verify each item on a clean computer (not the development machine):

### Authentication
- [ ] Clicking "Sign In with GitHub" opens a native browser dialog without any terminal
- [ ] OAuth flow completes and Codespaces load automatically
- [ ] "Enter PAT" option is visible and saves securely via `context.secrets`
- [ ] "Create Free GitHub Account" link opens `github.com/signup` in browser
- [ ] After signing out and back in, fresh data loads (token cache cleared)

### Multi-Device / Clean System
- [ ] Extension loads on a Windows PC with zero pre-installed tools (no git, no gh)
- [ ] Login works without GitHub CLI
- [ ] Dashboard shows Codespaces without GitHub CLI
- [ ] Start/Stop/Delete work without GitHub CLI
- [ ] SSH Connect appropriately prompts to install GitHub CLI when missing

### Cross-Platform
- [ ] `getGhExecutablePath()` finds `gh` at `/opt/homebrew/bin/gh` on macOS
- [ ] `getGhExecutablePath()` finds `gh` at `/usr/bin/gh` on Ubuntu
- [ ] `getAntigravityExePath()` does NOT contain any `\Users\lenovo\` path

### Security
- [ ] All three webviews have a `Content-Security-Policy` meta tag with nonce
- [ ] `acquireVsCodeApi()` is called exactly once per webview page
- [ ] No raw user data is injected into `innerHTML` without `escapeHtml()`
- [ ] `onDidReceiveMessage` validates command names and data shapes

### Bug Fixes
- [ ] `ANTIGRAVITY_EXE` is declared before use
- [ ] `GH_PATH` uses `getGhExecutablePath()`, not hardcoded `'gh'`
- [ ] SSH config does NOT contain `IdentityFile ~/.ssh/codespaces.auto`
- [ ] `tokenCache` is cleared in `refresh()` and after account switch
- [ ] `deactivate()` properly cleans up state
- [ ] Settings changes (e.g., toggling status bar) take effect without restart
- [ ] `getAccounts()` correctly reads both stdout and stderr from `gh auth status`

### User Experience
- [ ] Friendly error messages shown for all connection failures
- [ ] SSH connection failure for containers without sshd gives a helpful message
- [ ] Quick Actions menu shows Login option when user is not authenticated
- [ ] Dashboard correctly shows empty state with "Create First Codespace" guidance

---

*End of Audit Document — Antigravity Codespaces Pro v4.3.0 → v5.0.0*
