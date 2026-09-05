const { execFile } = require('child_process');
const { randomBytes } = require('crypto');

/**
 * Escapes unsafe characters to prevent XSS inside webviews.
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Generates a 32-character cryptographically random nonce for Content Security Policy.
 */
function generateNonce() {
    return randomBytes(16).toString('hex'); // 32 hex chars, cryptographically secure
}

/**
 * Formats ISO timestamps into readable relative time (e.g., 'just now', '5m ago', '2h ago').
 */
function formatRelativeTime(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const time = new Date(dateStr).getTime();
        if (!Number.isFinite(time)) return 'N/A';
        const diffMs = Date.now() - time;
        if (diffMs < 0) return 'just now'; // clock skew: future timestamp
        const m = Math.floor(diffMs / 60000);
        const h = Math.floor(m / 60);
        const d = Math.floor(h / 24);
        if (m < 1) return 'just now';
        if (m < 60) return `${m}m ago`;
        if (h < 24) return `${h}h ago`;
        return `${d}d ago`;
    } catch {
        return 'N/A';
    }
}

/**
 * Translates low-level network or CLI error messages into actionable, user-friendly guidance.
 */
function friendlyError(err) {
    if (!err) return 'Unknown error occurred.';
    let msg = typeof err === 'string' ? err : (err.message || String(err));
    if (msg.includes('Flag shorthand -r has been deprecated')) {
        msg = msg.replace(/Flag shorthand -r has been deprecated[^\n]*\n?/g, '').trim();
    }
    if (msg.includes('needs the "codespace" scope') || msg.includes('Must have admin rights to Repository') || msg.includes('lack the "codespace"')) {
        return 'GitHub account is missing the "codespace" permission. Run "gh auth refresh -h github.com -s codespace" in terminal or click Sign In.';
    }
    if (msg.includes('error getting machine type') || msg.includes('no terminal')) {
        return 'Could not determine Codespace machine type in non-interactive mode. Please specify a machine tier or use the dashboard wizard.';
    }
    if (msg.includes('Timed out')) {
        return 'Operation timed out. The cloud container may still be booting up — please try again in a few moments.';
    }
    if (msg.includes('not recognized') || msg.includes('ENOENT') || msg.includes('command not found')) {
        return 'GitHub CLI (gh) is not installed or not found in system PATH. Install it or use browser access.';
    }
    if (msg.includes('authentication') || msg.includes('Bad credentials') || msg.includes('401')) {
        return 'GitHub authentication expired or token is invalid. Please sign in again.';
    }
    if (msg.includes('not found') || msg.includes('404')) {
        return 'Codespace not found for this account. Only the owner can open a Codespace — verify at github.com/codespaces. Multi-account? The gh CLI may be signed into the wrong account (gh auth switch --user <owner>), then retry.';
    }
    if (msg.includes('timed out while waiting for the codespace to start') || msg.includes('timed out while waiting')) {
        return 'The container is still booting — this can take a minute on cold start. Press Start, wait for RUNNING, then connect again.';
    }
    if (msg.includes('failed to start SSH server') || msg.includes('SSH server') && msg.includes('check if')) {
        return 'No SSH server inside the container. Add "ghcr.io/devcontainers/features/sshd:1" to devcontainer.json features and rebuild, then connect.';
    }
    if (msg.includes('255') || msg.includes('closed unexpectedly') || msg.includes('Connection closed')) {
        return 'SSH tunnel dropped unexpectedly. Check the machine is RUNNING (press Start if stopped), verify the gh CLI account owns it, then retry. Details in Antigravity Codespaces logs.';
    }
    if (msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('abuse')) {
        return 'GitHub API rate limit reached. Wait a few minutes, then refresh.';
    }
    if (msg.includes('403') && (msg.includes('denied') || msg.includes('forbidden') || msg.includes('billing') || msg.includes('scope'))) {
        return 'GitHub access denied (HTTP 403). Check that your account has Codespaces permissions and billing enabled.';
    }
    if (msg.includes('billing') || msg.includes('quota') || msg.includes('exceeded')) {
        return 'GitHub Codespaces spending or quota limit reached. Check your GitHub account billing settings.';
    }
    if (msg.includes('EAI_AGAIN') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('network') || msg.includes('fetch failed')) {
        return 'Network unreachable. Check your internet connection, proxy, or corporate firewall, then try again.';
    }
    if (msg.includes('Timed out (') || msg.includes('timed out')) {
        return 'Operation timed out. The cloud container may still be working — please try again in a few moments.';
    }
    return msg.length > 300 ? msg.slice(0, 300) + '…' : msg;
}

/**
 * Executes a CLI command with timeout.
 *
 * Guarantees:
 * - Only stdout is resolved (stderr is surfaced on errors only), so callers can
 *   safely JSON.parse() the result even when the CLI prints warnings to stderr.
 * - The child process is always killed on timeout (no zombie processes).
 * - No shell fallback: arguments are passed directly to the executable via
 *   execFile, so shell metacharacters in arguments can never execute.
 */
function runCommand(cmd, args = [], timeoutMs = 15000, options = {}) {
    return new Promise((resolve, reject) => {
        const spawnOpts = { windowsHide: true, ...options };
        let child;
        try {
            child = execFile(cmd, args, { ...spawnOpts, timeout: timeoutMs }, (err, stdout, stderr) => {
                if (!err) return resolve((stdout || '').trim());
                const detail = (stderr || '').trim() || (stdout || '').trim() || err.message || '';
                const killed = err.killed || err.signal === 'SIGTERM';
                const timedOut = killed || /timed out|ETIMEDOUT/i.test(err.message || '');
                if (timedOut) {
                    return reject(new Error(`Timed out (${timeoutMs / 1000}s): ${cmd} ${(args || []).join(' ')}${detail ? ` — ${detail}` : ''}`));
                }
                reject(new Error(detail || `Command failed with exit code ${err.code}`));
            });
        } catch (spawnErr) {
            reject(spawnErr);
            return;
        }
        // Belt-and-braces: execFile's own `timeout` option already kills the child,
        // but ensure cleanup even on Node versions where it misbehaves.
        const guard = setTimeout(() => {
            try { if (child && !child.killed && child.exitCode === null) child.kill('SIGTERM'); } catch {}
        }, timeoutMs + 2000);
        if (guard.unref) guard.unref();
        const clear = () => clearTimeout(guard);
        child.on('exit', clear);
        child.on('error', clear);
    });
}

/**
 * Shared SVG icons for sidebar and dashboard webviews.
 */
const I = {
    cloud: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
    play:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="#0969da"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    stop:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="#cf222e"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
    power: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`,
    globe: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0969da" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    build: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    term:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
    trash: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    repo:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    branch:`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
    clock: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    server:`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
    desktop:`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    plus:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    sync:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>`,
    refresh:`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>`,
    user:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    search:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    plug:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v6m-6 4h12m-6 4v6m-4-6h8"/></svg>`,
    link:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    linkExternal: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0969da" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    zap:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    wrench: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    key:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>`,
    shield:`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    moon:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
    sun:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    chevron:`<svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    chevronDown: `<svg class="chev-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    chevronUp: `<svg class="chev-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`,
    github: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>`,
    checkCircle: `<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7.5" fill="#2ea043"/><path d="M4.5 8.2L6.8 10.5L11.5 5.8" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    alertTriangle: `<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 1.8L15 14H1L8 1.8Z" fill="#d29922"/><path d="M8 6V9.5" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.8" r="0.8" fill="#ffffff"/></svg>`,
    alertCircle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cf222e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    close: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    home: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    settings: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    moreVertical: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`,
    grid: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    list: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    cloudBrand: `<svg width="34" height="34" viewBox="0 0 48 48" fill="none"><path d="M14 36h21a9 9 0 0 0 1.2-17.9 12 12 0 0 0-23.4-2.1A10 10 0 0 0 14 36Z" fill="#0B75F0"/></svg>`,
    chevronRight: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    arrowLeft: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
    arrowRight: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
    pencil: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`,
    info: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    antigravityLogo: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 22 22 22"/><line x1="6" y1="14" x2="18" y2="14"/></svg>`,
    trashModal: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    cloudHero: `<svg class="hero-illustration-svg" width="140" height="100" viewBox="0 0 140 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="cloudGrad" x1="20" y1="20" x2="110" y2="90" gradientUnits="userSpaceOnUse">
          <stop stop-color="#388bfd" stop-opacity="0.9"/>
          <stop offset="1" stop-color="#1f6feb" stop-opacity="1"/>
        </linearGradient>
        <linearGradient id="cardGrad" x1="0" y1="0" x2="60" y2="40" gradientUnits="userSpaceOnUse">
          <stop stop-color="#ffffff" stop-opacity="0.95"/>
          <stop offset="1" stop-color="#f0f6fc" stop-opacity="0.9"/>
        </linearGradient>
        <filter id="softGlow" x="0" y="0" width="140" height="100" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="6" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>
      <!-- Background floating soft layer card -->
      <rect x="70" y="18" width="54" height="38" rx="6" fill="#e1ecfe" fill-opacity="0.7"/>
      <rect x="76" y="24" width="22" height="3" rx="1.5" fill="#8cb4f5"/>
      <rect x="76" y="30" width="36" height="3" rx="1.5" fill="#a5c8ff"/>
      <rect x="76" y="36" width="28" height="3" rx="1.5" fill="#c3dcff"/>

      <!-- Left background card -->
      <rect x="16" y="30" width="46" height="32" rx="6" fill="#e8f1fe" fill-opacity="0.8"/>
      <rect x="22" y="36" width="18" height="3" rx="1.5" fill="#8cb4f5"/>
      <rect x="22" y="42" width="28" height="3" rx="1.5" fill="#a5c8ff"/>

      <!-- Main Cloud -->
      <path d="M96 56C96 46.06 87.94 38 78 38C76.84 38 75.71 38.11 74.62 38.33C71.39 31.98 64.71 27.5 57 27.5C45.95 27.5 37 36.45 37 47.5C37 48.06 37.03 48.61 37.08 49.16C31.87 50.84 28 55.77 28 61.5C28 68.96 34.04 75 41.5 75H94C99.52 75 104 70.52 104 65C104 60.36 100.7 56.48 96 56Z" fill="url(#cloudGrad)"/>

      <!-- Foreground Code Card with </> symbol -->
      <g filter="url(#softGlow)">
        <rect x="42" y="46" width="52" height="34" rx="8" fill="url(#cardGrad)" stroke="#d0d7de" stroke-width="1.2"/>
        <!-- < / > code brackets -->
        <path d="M57 60L52 64L57 68" stroke="#1f6feb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M66 58L62 70" stroke="#0969da" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M71 60L76 64L71 68" stroke="#1f6feb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <!-- Sparkle accents -->
      <circle cx="28" cy="24" r="2" fill="#79c0ff"/>
      <circle cx="112" cy="62" r="1.5" fill="#54aeff"/>
    </svg>`,
    emptyHero: `<svg width="100" height="74" viewBox="0 0 100 74" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Browser window frame -->
      <rect x="4" y="4" width="92" height="66" rx="8" fill="currentColor" fill-opacity="0.04" stroke="currentColor" stroke-opacity="0.2" stroke-width="1.5"/>
      <line x1="4" y1="18" x2="96" y2="18" stroke="currentColor" stroke-opacity="0.15" stroke-width="1.2"/>
      <circle cx="13" cy="11" r="2" fill="currentColor" fill-opacity="0.3"/>
      <circle cx="20" cy="11" r="2" fill="currentColor" fill-opacity="0.3"/>
      <circle cx="27" cy="11" r="2" fill="currentColor" fill-opacity="0.3"/>
      <!-- Centered cloud in frame -->
      <path d="M68 47C68 41.5 63.5 37 58 37C57.4 37 56.7 37.06 56.1 37.18C54.3 33.6 50.6 31 46.3 31C40.2 31 35.2 36 35.2 42.1C35.2 42.4 35.2 42.7 35.3 43C32.4 44 30.2 46.7 30.2 49.9C30.2 54 33.6 57.4 37.7 57.4H67C70 57.4 72.5 55 72.5 52C72.5 49.5 70.6 47.4 68 47Z" fill="currentColor" fill-opacity="0.18"/>
    </svg>`
};

module.exports = {
    escapeHtml,
    generateNonce,
    formatRelativeTime,
    friendlyError,
    runCommand,
    I
};
