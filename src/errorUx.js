'use strict';
/**
 * Error UX: one place that turns failures into user-facing messages.
 *
 * Levels
 *  - critical: VS Code error notification + red inline banner. Real reason + one main fix button.
 *  - warning:  amber Cloud Hub banner, no popup (cached/offline, missing scope, near quota).
 *  - info:     status bar / quiet toast.
 *  - silent:   log only.
 *
 * Message shape: what happened, why, button(s). Never raw stack traces or "undefined".
 */

const GITHUB_STATUS_URL = 'https://www.githubstatus.com/';

const LEVELS = {
    critical: { icon: '⛔', label: 'Error' },
    warning: { icon: '⚠️', label: 'Warning' },
    info: { icon: 'ℹ️', label: 'Info' },
    silent: { icon: '', label: '' }
};

/** Strip stack traces, "undefined"/"null" fragments and excess whitespace. */
function cleanReason(raw) {
    let s = raw == null ? '' : String(raw && raw.message != null ? raw.message : raw);
    s = s.split(/\n\s*at\s/)[0];             // drop stack frames
    s = s.replace(/^(Error|TypeError|GithubRequestError):\s*/, '');
    s = s.replace(/\b(undefined|null)\b/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,:;])/g, '$1').trim();
    s = s.replace(/^[:.,\s]+|[:\s]+$/g, '');
    return s || 'Unknown error.';
}

/**
 * Classify an error for display.
 * @returns {{kind:string, level:string, title:string, why:string, actions:string[]}}
 * actions are ids: retry, workOffline, githubStatus, signIn, grantScope, setupDoctor, copySsh, details
 */
function classifyError(err) {
    const kind = err && err.kind;
    const msg = cleanReason(err);
    if (kind === 'timeout' || /isn't responding|ETIMEDOUT|TimeoutError/i.test(msg)) {
        return { kind: 'timeout', level: 'critical', title: "GitHub isn't responding (15s).", why: 'The request took too long. Your network or GitHub may be slow.', actions: ['retry', 'workOffline', 'details'] };
    }
    if (kind === 'server' || /having trouble|HTTP 5\d\d|returned 5\d\d/i.test(msg)) {
        return { kind: 'server', level: 'critical', title: 'GitHub is having trouble right now.', why: `GitHub returned a server error${err && err.status ? ' (' + err.status + ')' : ''}. We retried once.`, actions: ['retry', 'githubStatus', 'details'] };
    }
    if (kind === 'network' || /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|Couldn't reach GitHub/i.test(msg)) {
        return { kind: 'network', level: 'warning', title: "You're offline.", why: "Couldn't reach GitHub. Showing the last data we have.", actions: ['retry', 'details'] };
    }
    if (/authentication expired|Bad credentials|token is invalid|\b401\b/i.test(msg)) {
        return { kind: 'auth', level: 'critical', title: 'Your GitHub sign-in has expired.', why: 'GitHub rejected the saved token.', actions: ['signIn', 'details'] };
    }
    if (/"codespace" (scope|permission)|lack the "codespace"|needs the "user" scope|missing the "user"/i.test(msg)) {
        return { kind: 'scope', level: 'warning', title: 'A GitHub permission is missing.', why: msg, actions: ['grantScope', 'details'] };
    }
    if (kind === 'rateLimit' || /rate limit/i.test(msg)) {
        const at = err && err.resetAt ? new Date(err.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        return { kind: 'rateLimit', level: 'warning', title: 'GitHub rate limit reached.', why: at ? `Try again after ${at}.` : 'Wait a few minutes, then retry.', actions: ['retry', 'details'] };
    }
    return { kind: 'other', level: 'critical', title: 'Something went wrong.', why: msg, actions: ['retry', 'details'] };
}

const ACTION_LABELS = {
    retry: 'Retry', workOffline: 'Work offline', githubStatus: 'GitHub Status', signIn: 'Sign in with gh',
    grantScope: 'Grant permission', setupDoctor: 'Run Setup Doctor', copySsh: 'Copy SSH command', details: 'Details',
    createCodespace: 'Create codespace', openUsage: 'Open Usage'
};

/** Copy for a failed connect. Card reverts to Available (the caller refreshes the views). */
function connectFailure(repoOrName, reason) {
    return { kind: 'connect', level: 'critical', title: `Couldn't open ${repoOrName || 'the codespace'} in this IDE.`, why: cleanReason(reason || 'No Remote-SSH handler or launcher accepted the connection.'), actions: ['setupDoctor', 'copySsh', 'details'] };
}

/** Real reason when waking a codespace fails during reconnect (SSH is skipped). */
function startFailure(name, err) {
    const raw = cleanReason(err);
    let why = raw;
    if (/\b404\b|not found/i.test(raw)) why = 'It no longer exists (it may have been deleted or expired).';
    else if (/\b402\b|quota|spending limit|billing/i.test(raw)) why = 'Your Codespaces quota or spending limit has been reached.';
    else if (err && err.kind) why = classifyError(err).title;
    return { kind: 'start', level: 'critical', title: `Couldn't start ${name}.`, why, actions: ['retry', 'details'] };
}

/** "Title Why" for a VS Code notification (no stack, no undefined). */
function notificationText(c) { return `${c.title} ${c.why && c.why !== c.title ? c.why : ''}`.trim(); }

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

/**
 * Inline banner. Icon + text label (not colour only). Dismissible; it is rendered again on the next refresh
 * if the problem is still there.
 */
function bannerHtml(c, opts = {}) {
    const lv = LEVELS[c.level] || LEVELS.warning;
    const asOf = opts.asOf ? ` <span class="ux-asof">Showing data as of ${esc(opts.asOf)}.</span>` : '';
    const btns = (c.actions || []).map((a, i) => `<button class="ux-btn${i === 0 ? ' ux-btn-primary' : ''}" data-ux-action="${esc(a)}"${opts.account ? ` data-acc="${esc(opts.account)}"` : ''}>${esc(ACTION_LABELS[a] || a)}</button>`).join('');
    return `<div class="ux-banner ux-${esc(c.level)}" role="${c.level === 'critical' ? 'alert' : 'status'}" data-ux-kind="${esc(c.kind)}">
<span class="ux-icon" aria-hidden="true">${lv.icon}</span><div class="ux-text"><span class="ux-label">${lv.label}</span> <b>${esc(c.title)}</b> <span class="ux-why">${esc(c.why && c.why !== c.title ? c.why : '')}</span>${asOf}</div>
<div class="ux-actions">${btns}</div>${opts.dismissible === false ? '' : '<button class="ux-dismiss" aria-label="Dismiss" title="Dismiss">×</button>'}</div>`;
}

/** Skeleton placeholder cards shown while loading. */
function skeletonHtml(n = 3) {
    return `<div class="ux-skel-grid" aria-busy="true" aria-label="Loading codespaces">${Array.from({ length: n }, () => '<div class="ux-skel-card"><div class="ux-skel l1"></div><div class="ux-skel l2"></div><div class="ux-skel l3"></div><div class="ux-skel btn"></div></div>').join('')}<span class="ux-sr">Loading…</span></div>`;
}

const UX_CSS = `
.ux-banner{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;border:1px solid;margin:0 0 12px;font-size:12.5px;line-height:1.45}
.ux-critical{background:rgba(220,38,38,.08);border-color:rgba(220,38,38,.45)}
.ux-warning{background:rgba(217,119,6,.09);border-color:rgba(217,119,6,.45)}
.ux-info{background:rgba(11,117,240,.07);border-color:rgba(11,117,240,.35)}
.ux-icon{font-size:15px;line-height:1.2}
.ux-text{flex:1;min-width:0}
.ux-label{font-weight:700;text-transform:uppercase;font-size:10.5px;letter-spacing:.05em}
.ux-critical .ux-label{color:#dc2626}.ux-warning .ux-label{color:#b45309}.ux-info .ux-label{color:#0b75f0}
.ux-why,.ux-asof{color:var(--hub-text-muted,#64748b)}
.ux-actions{display:flex;gap:6px;flex-wrap:wrap}
.ux-btn{border:1px solid var(--hub-border,#dce3ec);background:var(--hub-bg-card,#fff);color:inherit;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
.ux-btn-primary{background:#0b75f0;border-color:#0b75f0;color:#fff}
.ux-btn[disabled]{opacity:.6;cursor:progress}
.ux-dismiss{background:none;border:none;font-size:16px;line-height:1;cursor:pointer;color:var(--hub-text-muted,#64748b);padding:2px 4px}
.ux-skel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.ux-skel-card{border:1px solid var(--hub-border,#dce3ec);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;background:var(--hub-bg-card,#fff)}
.ux-skel{border-radius:6px;background:linear-gradient(90deg,rgba(127,127,127,.12),rgba(127,127,127,.22),rgba(127,127,127,.12));background-size:200% 100%;animation:uxsh 1.2s ease-in-out infinite;height:12px}
.ux-skel.l1{width:60%;height:14px}.ux-skel.l2{width:85%}.ux-skel.l3{width:40%}.ux-skel.btn{width:96px;height:28px;margin-top:6px}
@keyframes uxsh{0%{background-position:200% 0}100%{background-position:-200% 0}}
@media (prefers-reduced-motion: reduce){.ux-skel,.btn-spin{animation:none}}
.ux-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.btn-spin{display:inline-block;width:11px;height:11px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:uxspin .8s linear infinite;vertical-align:-1px;margin-right:4px}
@keyframes uxspin{to{transform:rotate(360deg)}}
.ux-signedout{display:flex;justify-content:center;align-items:center;min-height:50vh}
`;

module.exports = { LEVELS, GITHUB_STATUS_URL, ACTION_LABELS, cleanReason, classifyError, connectFailure, startFailure, notificationText, bannerHtml, skeletonHtml, UX_CSS };
