const errorUx = require('./errorUx');
/**
 * HTML builders for Codespaces usage analytics (active gh account only).
 *  - Sidebar: one compact summary under the account picker.
 *  - Cloud Hub dashboard: a compact usage card above the KPI grid, plus a
 *    detailed "Usage" page reachable from the left rail.
 * Every figure is either straight from the GitHub billing API or plain
 * arithmetic on it; derived values are labelled "derived" with the formula
 * in a tooltip. Pure functions (no vscode import) so they are unit-testable.
 */
const { escapeHtml } = require('./utils');

const LINKS = {
    billing: 'https://github.com/settings/billing',
    spending: 'https://github.com/settings/billing',
    codespacesSettings: 'https://github.com/settings/codespaces',
    docs: 'https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-codespaces/about-billing-for-github-codespaces',
    storageDocs: 'https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-codespaces/about-billing-for-github-codespaces#billing-for-storage-usage'
};

function fmtDateTimeUtc(ms) {
    const date = new Date(ms);
    if (!Number.isFinite(date.getTime())) return 'unavailable';
    const value = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        hourCycle: 'h23', timeZone: 'UTC'
    }).format(date);
    return `${value} UTC`;
}
function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }); } catch { return ''; }
}
function fmtDayKey(key) { return fmtDate(key + 'T00:00:00Z'); }
function n1(v) { return (Math.round((Number(v) || 0) * 10) / 10).toFixed(1).replace(/\.0$/, ''); }
function d1(v) { return (Math.round((Number(v) || 0) * 10) / 10).toFixed(1); }
function n2(v) { return String(Math.round((Number(v) || 0) * 100) / 100); }
function money(v) { return '$' + (Number(v) || 0).toFixed(2); }
function hasData(u) { return !!(u && u.stats && u.mode === 'live'); }
function prefersDollars(u, opts) { return !!(opts && opts.preferredUnit === 'dollars' && u && u.compute && u.compute.amount != null); }

function daysLeftShort(s) {
    if (!s) return '—';
    if (s.daysLeftLabel.startsWith('about')) return '~' + Math.max(0, Math.floor(s.daysLeft)) + ' days left';
    return s.daysLeftLabel;
}
function daysLeftValue(s) {
    if (!s) return '—';
    if (s.daysLeftLabel.startsWith('about')) return String(Math.max(0, Math.floor(s.daysLeft)));
    if (s.daysLeftLabel === "won't run out before reset") return "Won't run out";
    if (s.daysLeftLabel === 'quota used up') return '0';
    return '—';
}

/** One sentence describing the projection (derived). */
function projectionText(u) {
    const a = u && u.analytics;
    if (!a) return '';
    if (a.projectionLabel === 'Closed month') return `Closed month · ${n1(u.stats.used)} core-hrs used`;
    if (a.projectionLabel === 'runs out' && a.runOutDate) return `At this pace: ~${n1(a.projectedEnd)} core-hrs by reset — runs out ~${fmtDate(a.runOutDate)}`;
    if (a.projectionLabel === "won't run out before reset") return `At this pace: ~${n1(a.projectedEnd)} core-hrs by reset (${fmtDate(u.resetDate)}), won't run out`;
    return a.projectionLabel;
}
const PROJECTION_TIP = 'Derived: used + (last-7-day average core-hrs/day × days left in the cycle). Run-out date = now + remaining ÷ average.';

// ── Sidebar ────────────────────────────────────────────────────────────────

const SIDEBAR_CSS = `
.usage-mini{margin:6px 10px 2px;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:11px;color:var(--vscode-foreground);border:1px solid var(--vscode-widget-border, var(--vscode-panel-border))}
.usage-mini:hover,.usage-mini:focus{background:var(--vscode-list-hoverBackground);outline:none}
.usage-mini-top{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px;color:var(--vscode-descriptionForeground)}
.usage-mini-tag{font-size:9px;padding:0 5px;border-radius:8px;border:1px solid var(--vscode-editorWarning-foreground);color:var(--vscode-editorWarning-foreground)}
.usage-mini-bar{height:3px;border-radius:2px;background:var(--vscode-editorWidget-border, rgba(128,128,128,.3));overflow:hidden}
.usage-mini-fill{height:100%;background:var(--vscode-progressBar-background)}
.usage-mini-fill.amber{background:var(--vscode-editorWarning-foreground)}
.usage-mini-fill.red{background:var(--vscode-editorError-foreground)}
.usage-mini-line{margin-top:4px}
.usage-mini-link{color:var(--vscode-textLink-foreground);cursor:pointer;background:none;border:none;padding:0;font-size:11px}
.usage-mini-link:hover{text-decoration:underline}
`;

/** Compact sidebar summary for the active account (or '' when nothing to show / hidden by setting). */
function sidebarSummaryHtml(u, nonce, opts = {}) {
    if (!u || opts.show === false) return '';
    const acc = escapeHtml(u.account);
    const plan = u.plan ? ` · ${escapeHtml(u.plan.label)}` : '';
    const sourceTag = hasData(u) ? `<span class="usage-mini-tag" title="GitHub-reported billing totals; delayed and not attributable to an individual Codespace">reported · ${escapeHtml(fmtDateTimeUtc(u.lastUpdated || u.fetchedAt))}</span>` : '';
    const offlineTag = u.offline ? `<span class="usage-mini-tag" title="Network unavailable; cached billing data may be stale">offline</span>` : '';
    const top = `<div class="usage-mini-top"><span>Usage${plan}</span>${sourceTag}${offlineTag}</div>`;
    let body;
    if (u.mode === 'needsPermission') {
        body = `<div class="usage-mini-line">Grant access to see usage · <button class="usage-mini-link" data-usage-grant="${acc}">Grant access</button></div>`;
    } else if (u.mode === 'orgBilled') {
        body = `<div class="usage-mini-line">Billed to ${escapeHtml((u.orgBilled || []).join(', ') || 'organization')}</div>`;
    } else if (hasData(u)) {
        const s = u.stats;
        const fig = prefersDollars(u, opts) && u.compute.quotaValue
            ? `${money(u.compute.amount)} / ${money(u.compute.quotaValue)} compute`
            : `${n1(s.used)} / ${s.quota} core-hrs`;
        body = `<div class="usage-mini-bar" role="progressbar" aria-valuenow="${Math.round(s.pct)}" aria-valuemin="0" aria-valuemax="100"><div class="usage-mini-fill ${s.level}" style="width:${Math.min(100, s.pct)}%"></div></div>
<div class="usage-mini-line">${fig} · ${escapeHtml(daysLeftShort(s))}</div>`;
    } else if (u.mode === 'offline') {
        body = `<div class="usage-mini-line" role="status"><span aria-hidden="true">⚠️</span> <b>Offline</b> · usage refreshes when GitHub is reachable</div>`;
    } else if (u.kind === 'auth') {
        body = `<div class="usage-mini-line" role="alert"><span aria-hidden="true">⛔</span> GitHub sign-in expired · <button class="usage-mini-link" data-usage-signin="1">Sign in again</button></div>`;
    } else {
        body = `<div class="usage-mini-line" title="${escapeHtml([u.error, u.why].filter(Boolean).join(' '))}">${escapeHtml(u.kind === 'malformed' || u.kind === 'rateLimit' ? u.error : 'Usage unavailable')}${u.status && u.kind !== 'rateLimit' && u.kind !== 'malformed' ? ' (' + escapeHtml(String(u.status)) + ')' : ''}</div>`;
    }
    return `<style nonce="${nonce}">${SIDEBAR_CSS}</style><div class="usage-mini" role="button" tabindex="0" data-usage-open="${acc}" title="Open Codespaces usage in Cloud Hub">${top}${body}</div>`;
}

/** Click wiring; placed AFTER the sidebar's main script (reuses its `vscode` handle). */
function buildSidebarUsageScript(nonce) {
    return `<script nonce="${nonce}">(function(){const vs=(typeof vscode!=='undefined')?vscode:acquireVsCodeApi();
document.querySelectorAll('[data-usage-grant]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();vs.postMessage({command:'usageGrantAccess',account:b.getAttribute('data-usage-grant')});}));
document.querySelectorAll('[data-usage-signin]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();vs.postMessage({command:'loginGitHub'});}));
document.querySelectorAll('[data-usage-open]').forEach(c=>{const go=()=>vs.postMessage({command:'openUsageDashboard'});c.addEventListener('click',go);c.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});});})();</script>`;
}

// ── Cloud Hub dashboard ────────────────────────────────────────────────────

const HUB_CSS = `
.usage-hero{background:var(--hub-bg-card);border:1px solid var(--hub-border);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:16px;box-shadow:var(--shadow-card);cursor:pointer}
.usage-hero:hover,.usage-hero:focus-visible{border-color:var(--hub-accent);outline:none}
.usage-hero .kpi-icon-box{background:var(--hub-accent-soft);color:var(--hub-accent)}
.usage-hero-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.usage-hero-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.usage-bar{height:6px;border-radius:3px;background:var(--hub-border-subtle);overflow:hidden;max-width:560px}
.usage-fill{height:100%;background:var(--hub-accent);border-radius:3px}
.usage-fill.amber{background:var(--hub-warning)}
.usage-fill.red{background:var(--hub-danger)}
.usage-qrow{display:flex;flex-direction:column;gap:3px;max-width:560px}
.usage-qhead{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--hub-text-main)}
.usage-qlabel{font-weight:600;color:var(--hub-text-muted)}
.usage-qfig small{color:var(--hub-text-muted)}
.usage-hero code,.usage-page code{font-family:var(--mono-font);font-size:11px;background:var(--hub-accent-soft);padding:1px 5px;border-radius:4px}
.usage-hero-figure{font-size:15px;font-weight:700;color:var(--hub-text-main)}
.usage-hero-figure small{font-size:12px;font-weight:500;color:var(--hub-text-muted)}
.usage-hero-side{display:flex;gap:22px;flex-shrink:0}
.usage-stat{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.usage-stat .kpi-value{font-size:20px}
.usage-tag{font-size:10px;font-weight:600;padding:1px 7px;border-radius:10px;background:var(--hub-warning-soft);color:var(--hub-warning);text-transform:none;letter-spacing:0}
.usage-tag.off{background:var(--hub-danger-soft);color:var(--hub-danger-text)}
.usage-derived{font-size:9px;font-weight:600;padding:0 5px;border-radius:8px;background:var(--hub-accent-soft);color:var(--hub-accent);text-transform:uppercase;letter-spacing:.4px;margin-left:4px;vertical-align:middle}
.usage-muted{font-size:11px;color:var(--hub-text-muted)}
.usage-proj{font-size:12px;color:var(--hub-text-main)}
.usage-page{display:none;flex-direction:column;gap:14px}
.main-canvas.show-usage > section:not(.usage-page){display:none !important}
.main-canvas.show-usage > .usage-page{display:flex}
.usage-panel{background:var(--hub-bg-card);border:1px solid var(--hub-border);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow-card)}
.usage-panel h3{font-size:12px;font-weight:600;color:var(--hub-text-muted);text-transform:uppercase;letter-spacing:.5px;margin:0 0 10px;display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}
.usage-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.usage-warn-note{background:rgba(217,119,6,.09);border:1px solid rgba(217,119,6,.45);border-radius:8px;padding:8px 10px;font-size:12px;margin:6px 0}
.usage-warn-note b{color:#b45309;text-transform:uppercase;font-size:10.5px;letter-spacing:.05em}
.usage-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.usage-qfacts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid var(--hub-border-subtle)}
.usage-qfacts>div{display:flex;flex-direction:column;gap:2px}
.usage-qfacts b{font-size:16px}
.usage-spark{display:flex;flex-direction:column;gap:2px;margin:4px 0 8px}
.usage-spark svg{width:100%;height:44px}
.usage-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.usage-scroll .usage-table{min-width:560px}
.usage-tile{background:var(--hub-bg-card);border:1px solid var(--hub-border);border-radius:12px;padding:12px 14px;box-shadow:var(--shadow-card);display:flex;flex-direction:column;gap:3px;cursor:help}
.usage-tile .kpi-value{font-size:20px}
.usage-tile .usage-sub{font-size:11px;color:var(--hub-text-muted)}
.usage-table{width:100%;border-collapse:collapse;font-size:12px}
.usage-table th{text-align:left;font-weight:600;color:var(--hub-text-muted);padding:6px 8px;border-bottom:1px solid var(--hub-border);cursor:pointer;user-select:none;white-space:nowrap}
.usage-table th[aria-sort="ascending"]::after{content:" ▲";font-size:9px}
.usage-table th[aria-sort="descending"]::after{content:" ▼";font-size:9px}
.usage-table td{padding:6px 8px;border-bottom:1px solid var(--hub-border-subtle);color:var(--hub-text-main);vertical-align:middle}
.usage-table td.num,.usage-table th.num{text-align:right}
.usage-table tfoot td{font-weight:600;border-bottom:none}
.usage-table tr.usage-detail td{background:var(--hub-bg-page);padding:10px 12px}
.usage-expand{background:none;border:1px solid var(--hub-border);color:var(--hub-text-muted);border-radius:6px;min-width:28px;height:28px;cursor:pointer;line-height:1;padding:0;margin:-4px 8px -4px 0;font-size:13px;vertical-align:middle}
.usage-expand:hover,.usage-expand:focus-visible{border-color:var(--hub-accent);color:var(--hub-accent);outline:none}
.usage-repo-row td:first-child{white-space:nowrap}
.usage-expand[aria-expanded="true"]{background:var(--hub-accent-soft);color:var(--hub-accent);border-color:var(--hub-accent)}
.usage-page-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.usage-page-head h2{font-size:16px;margin:0;color:var(--hub-text-main)}
.usage-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.usage-select,.usage-filter{background:var(--hub-input-bg);color:var(--hub-text-main);border:1px solid var(--hub-border);border-radius:8px;padding:5px 8px;font-size:12px;font-family:var(--font)}
.usage-filter{min-width:180px}
.usage-link{background:none;border:none;color:var(--hub-accent);cursor:pointer;font-size:12px;padding:0;font-family:var(--font)}
.usage-link:hover{text-decoration:underline}
.usage-seg{display:inline-flex;border:1px solid var(--hub-border);border-radius:8px;overflow:hidden}
.usage-seg button{background:var(--hub-bg-card);color:var(--hub-text-muted);border:none;padding:3px 10px;font-size:11px;cursor:pointer}
.usage-seg button[aria-pressed="true"]{background:var(--hub-accent);color:#fff}
.usage-chips{display:flex;flex-wrap:wrap;gap:8px}
.usage-chip{border:1px solid var(--hub-border);border-radius:10px;padding:8px 12px;display:flex;flex-direction:column;gap:2px;min-width:96px}
.usage-chip b{font-size:16px;color:var(--hub-text-main)}
.usage-mom{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
.usage-delta.up{color:var(--hub-warning)}.usage-delta.down{color:var(--hub-success)}
.usage-daystats{display:flex;gap:18px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--hub-text-main)}
.usage-chart-wrap svg rect.bar:hover{opacity:.75}
.usage-legend{display:flex;gap:14px;font-size:11px;color:var(--hub-text-muted);margin-top:6px;flex-wrap:wrap}
.usage-legend i{display:inline-block;width:14px;height:3px;vertical-align:middle;margin-right:4px;border-radius:2px}
.usage-hidden{display:none !important}
@media (max-width: 900px){.usage-grid2{grid-template-columns:1fr}.usage-hero{flex-wrap:wrap}}
@media (max-width: 600px){.usage-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.usage-mom{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
`;

function levelOf(used, quota) { const p = quota > 0 ? (used / quota) * 100 : 0; return p >= 90 ? 'red' : p >= 75 ? 'amber' : 'ok'; }
function pctOf(used, quota) { return quota > 0 ? Math.min(100, (used / quota) * 100) : 0; }

/** Two separate quota bars (compute, storage). Quotas are not interchangeable, so no combined total. */
function quotaBarsHtml(u, opts) {
    const c = u.compute || { used: u.stats.used, quota: u.stats.quota };
    const st = u.storage || {};
    const dollars = prefersDollars(u, opts);
    const row = (label, used, quota, unit, amount, value) => {
        const fig = dollars && amount != null && value != null
            ? `<b>${money(amount)}</b> / ${money(value)} <small>(${n1(used)} / ${quota} ${unit})</small>`
            : `<b>${n1(used)}</b> / ${quota} ${unit}${amount != null && value != null ? ` <small>(${money(amount)} of ${money(value)})</small>` : ''}`;
        return `<div class="usage-qrow"><div class="usage-qhead"><span class="usage-qlabel">${label}</span><span class="usage-qfig">${fig}</span></div><div class="usage-bar" role="progressbar" aria-label="${label} quota used" aria-valuenow="${Math.round(pctOf(used, quota))}" aria-valuemin="0" aria-valuemax="100"><div class="usage-fill ${levelOf(used, quota)}" style="width:${pctOf(used, quota)}%"></div></div></div>`;
    };
    return row('Compute', c.used, c.quota, 'core-hrs', c.amount, c.quotaValue)
        + (st.used != null ? row('Storage', st.used, st.quota, 'GB-month', st.amount, st.quotaValue) : '');
}
function billingLineHtml(u) {
    const d = u.dollars;
    if (!d) return '';
    return `<div class="usage-muted" title="From the billing summary API: grossAmount, discountAmount, netAmount">Billing this cycle: ${money(d.consumed)} consumed · −${money(d.discount)} included discount · <b>${money(d.billable)} billable</b></div>`;
}
function errorBodyHtml(u) {
    if (u.mode === 'offline') {
        return errorUx.bannerHtml({ kind: 'network', level: 'warning', title: u.error || "You're offline.", why: u.why || '', actions: ['retry'] }, { dismissible: false });
    }
    if (u.kind === 'auth') {
        return `<div class="usage-hero-figure">GitHub sign-in expired <small>${escapeHtml(u.why || '')}</small></div><div><button class="btn-new-cs" data-usage-signin="1">Sign in again</button></div>`;
    }
    if (u.kind === 'malformed') {
        // Technical detail is only in the log (Details).
        return errorUx.bannerHtml({ kind: 'malformed', level: 'critical', title: u.error, why: u.why || '', actions: ['retry', 'details'] }, { dismissible: false });
    }
    const title = u.kind === 'malformed' || u.kind === 'rateLimit' ? u.error : 'Usage unavailable';
    const why = u.kind === 'malformed' || u.kind === 'rateLimit' ? (u.why || '') : (u.error || 'Unknown error');
    return `<div class="usage-hero-figure">${escapeHtml(title)} <small>${escapeHtml(why)}</small></div>${u.fix ? `<div class="usage-muted">Fix: <code>${escapeHtml(u.fix)}</code></div>` : ''}`;
}
function tagsHtml(u) {
    return (u.offline ? `<span class="usage-tag off">offline · last fetched ${escapeHtml(fmtDateTimeUtc(u.lastUpdated || u.fetchedAt))}</span>` : '')
        + (u.isCurrent === false ? `<span class="usage-tag">closed month</span>` : '');
}

/** Compact usage card shown above the Cloud Hub KPI grid. */
function hubUsageCardHtml(u, icon = '', opts = {}) {
    if (!u) return '';
    const head = `<div class="usage-hero-head"><span class="kpi-label">USAGE · ${escapeHtml(u.login || u.account)}${u.plan ? ' · ' + escapeHtml(u.plan.label) : ''}</span>${tagsHtml(u)}</div>`;
    const iconBox = `<div class="kpi-icon-box">${icon}</div>`;
    if (u.mode === 'needsPermission') {
        return `<section class="usage-hero" id="usageHero" tabindex="0">${iconBox}<div class="usage-hero-main">${head}<div class="usage-hero-figure">Usage needs permission <small>GitHub's billing API needs the "user" scope</small></div></div><button class="btn-new-cs" data-usage-grant="${escapeHtml(u.account)}">Grant access</button></section>`;
    }
    if (u.mode === 'orgBilled') {
        return `<section class="usage-hero" id="usageHero" tabindex="0">${iconBox}<div class="usage-hero-main">${head}<div class="usage-hero-figure">Billed to ${escapeHtml((u.orgBilled || []).join(', ') || 'organization')}</div></div></section>`;
    }
    if (!hasData(u)) {
        return `<section class="usage-hero" id="usageHero" tabindex="0">${iconBox}<div class="usage-hero-main">${head}${errorBodyHtml(u)}</div></section>`;
    }
    const s = u.stats;
    const proj = projectionText(u);
    return `<section class="usage-hero" id="usageHero" tabindex="0" role="button" aria-label="Open usage details" title="Open usage details">${iconBox}
<div class="usage-hero-main">${head}
${quotaBarsHtml(u, opts)}
${proj ? `<div class="usage-proj" title="${escapeHtml(PROJECTION_TIP)}">${escapeHtml(proj)}<span class="usage-derived">derived</span></div>` : ''}
<div class="usage-muted">Resets ${escapeHtml(fmtDate(u.resetDate))}</div>
${billingLineHtml(u)}</div>
<div class="usage-hero-side">
<div class="usage-stat" title="Derived: plan quota − core-hrs used"><span class="kpi-label">HOURS LEFT</span><span class="kpi-value">${n1(s.remaining)}</span></div>
<div class="usage-stat" title="Derived: remaining ÷ last-7-day average (${d1(s.avgPerDay)} core-hrs/day)"><span class="kpi-label">DAYS LEFT</span><span class="kpi-value">${escapeHtml(daysLeftValue(s))}</span></div>
</div></section>`;
}

/** Value for the existing Storage Tier KPI card. */
function storageTierText(u) {
    if (hasData(u) && u.storage && u.storage.quota && u.storage.used != null) return `${n1(u.storage.used)} / ${u.storage.quota} GB-month`;
    // No usage data: show the included storage only when the plan came from GitHub's API; otherwise hide the tile.
    if (u && u.plan && !u.plan.guessed && u.plan.personal && u.plan.storageGb) return `${u.plan.storageGb} GB-month · ${u.plan.label}`;
    return '';
}

/**
 * Daily bar chart (inline SVG). Each bar has a <title> tooltip with exact values.
 * @param {Array<{date,value,amount}>} series
 * @param {{unit:string, idealPerDay?:number, color?:string, label:string, digits?:number}} o
 */
function barChartSvg(series, o) {
    const W = 600, H = o.height || 140, n = Math.max(1, series.length), bw = W / n;
    const ideal = o.idealPerDay || 0;
    const max = Math.max(1e-6, ideal * 1.3, ...series.map(x => x.value || 0));
    const dg = o.digits == null ? 2 : o.digits;
    const bars = series.map((x, i) => {
        const h = ((x.value || 0) / max) * (H - 16);
        const tip = `${fmtDayKey(x.date)}: ${(Math.round((x.value || 0) * Math.pow(10, dg)) / Math.pow(10, dg))} ${o.unit} · ${money(x.amount)}`;
        return `<rect class="bar" x="${(i * bw + 1.5).toFixed(1)}" y="${(H - Math.max(h, x.value > 0 ? 1 : 0)).toFixed(1)}" width="${Math.max(1, bw - 3).toFixed(1)}" height="${Math.max(h, x.value > 0 ? 1 : 0).toFixed(1)}" rx="2" fill="${o.color || 'var(--hub-accent)'}" opacity="${x.future ? 0.25 : 1}"><title>${escapeHtml(tip)}</title></rect>`;
    }).join('');
    const iy = (H - (ideal / max) * (H - 16)).toFixed(1);
    const line = ideal ? `<line x1="0" x2="${W}" y1="${iy}" y2="${iy}" stroke="var(--hub-warning)" stroke-width="1.5" stroke-dasharray="5 4"><title>Ideal pace: ${n1(ideal)} ${o.unit}/day</title></line>` : '';
    const first = series[0], last = series[series.length - 1];
    const axis = first ? `<text x="2" y="${H + 12}" font-size="10" fill="var(--hub-text-muted)">${escapeHtml(fmtDayKey(first.date))}</text><text x="${W - 2}" y="${H + 12}" font-size="10" text-anchor="end" fill="var(--hub-text-muted)">${escapeHtml(fmtDayKey(last.date))}</text><text x="${W - 2}" y="10" font-size="10" text-anchor="end" fill="var(--hub-text-muted)">max ${(Math.round(max * 100) / 100)} ${escapeHtml(o.unit)}</text>` : '';
    return `<svg viewBox="0 0 ${W} ${H + 16}" width="100%" height="${H + 16}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(o.label)}">${bars}${line}${axis}</svg>`;
}

/** Cumulative usage line vs ideal pace line vs quota. */
function cumulativeSvg(series, quota) {
    const W = 600, H = 150, n = Math.max(1, series.length);
    const lastCum = Math.max(0, ...series.map(x => x.cumulative || 0));
    const max = Math.max(1e-6, quota * 1.05, lastCum * 1.1);
    const x = (i) => ((i + 0.5) / n) * W;
    const y = (v) => H - (v / max) * (H - 10);
    const pts = series.filter(p => p.cumulative != null).map((p, i) => `${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(' ');
    const pace = series.map((p, i) => `${x(i).toFixed(1)},${y(p.pace).toFixed(1)}`).join(' ');
    const dots = series.filter(p => p.cumulative != null).map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.cumulative).toFixed(1)}" r="5" fill="transparent"><title>${escapeHtml(fmtDayKey(p.date))}: ${n2(p.cumulative)} core-hrs cumulative · pace ${n2(p.pace)}</title></circle>`).join('');
    const qy = y(quota).toFixed(1);
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="Cumulative core-hours versus ideal pace">
${quota ? `<line x1="0" x2="${W}" y1="${qy}" y2="${qy}" stroke="var(--hub-danger)" stroke-width="1" stroke-dasharray="2 3"><title>Quota: ${quota} core-hrs</title></line>` : ''}
<polyline points="${pace}" fill="none" stroke="var(--hub-warning)" stroke-width="1.5" stroke-dasharray="5 4"/>
${pts ? `<polyline points="${pts}" fill="none" stroke="var(--hub-accent)" stroke-width="2.2"/>` : ''}${dots}</svg>`;
}

/** Tiny sparkline of a repo's daily core-hrs across the cycle. */
function sparklineSvg(daily, cycleStart, totalDays) {
    const W = 160, H = 28, start = new Date(cycleStart).getTime();
    const vals = [];
    for (let i = 0; i < totalDays; i++) vals.push(Number(daily && daily[new Date(start + i * 86400000).toISOString().slice(0, 10)]) || 0);
    const max = Math.max(1e-6, ...vals);
    const pts = vals.map((v, i) => `${((i / Math.max(1, totalDays - 1)) * W).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Daily core-hours sparkline"><polyline points="${pts}" fill="none" stroke="var(--hub-accent)" stroke-width="1.5"/></svg>`;
}

/** Legacy single chart (kept for callers without analytics). */
function chartSvg(u) {
    const start = new Date(u.cycleStart), reset = new Date(u.resetDate);
    const days = Math.max(1, Math.round((reset - start) / 86400000));
    const series = [];
    for (let i = 0; i < days; i++) {
        const key = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
        series.push({ date: key, value: (u.daily && u.daily[key]) || 0, amount: (u.dailyAmount && u.dailyAmount[key]) || 0 });
    }
    return barChartSvg(series, { unit: 'core-hrs', idealPerDay: u.stats && u.stats.quota ? u.stats.quota / days : 0, label: 'Daily core-hours' });
}

function tile(label, value, tip, sub = '', derived = false) {
    return `<div class="usage-tile" tabindex="0" title="${escapeHtml(tip)}"><span class="kpi-label">${label}${derived ? '<span class="usage-derived">derived</span>' : ''}</span><span class="kpi-value">${value}</span>${sub ? `<span class="usage-sub">${sub}</span>` : ''}</div>`;
}

function deltaHtml(d, unit, isMoney) {
    if (!d) return '—';
    const sign = d.delta > 0 ? '+' : d.delta < 0 ? '−' : '±';
    const abs = Math.abs(d.delta);
    const val = isMoney ? money(abs) : `${n1(abs)} ${unit}`;
    return `<span class="usage-delta ${d.delta > 0 ? 'up' : d.delta < 0 ? 'down' : ''}">${sign}${val}${d.pct != null ? ` (${d.pct > 0 ? '+' : ''}${d.pct}%)` : ''}</span>`;
}

/** The "Usage" page (hidden until the rail item / usage card is clicked). */
function hubUsagePageHtml(u, opts = {}) {
    const months = (u && u.months) || [];
    const sel = u && u.period ? `${u.period.year}-${u.period.month}` : '';
    const monthSelect = months.length ? `<label class="usage-muted" for="usageMonth">Month</label><select class="usage-select" id="usageMonth" aria-label="Billing month">${months.map(m => `<option value="${m.year}-${m.month}"${`${m.year}-${m.month}` === sel ? ' selected' : ''}>${escapeHtml(m.label)}${m.current ? ' (current)' : ''}</option>`).join('')}</select>` : '';
    const freshness = !u ? 'Billing data unavailable' : hasData(u)
        ? `GitHub-reported totals · delayed reporting · last fetched ${fmtDateTimeUtc(u.fetchedAt)}`
        : `Last checked ${fmtDateTimeUtc(u.fetchedAt)}`;
    const head = (title) => `<div class="usage-page-head"><h2>${title}</h2><div class="usage-actions">${u ? tagsHtml(u) : ''}${monthSelect}<span class="usage-muted" title="GitHub billing is delayed and is not a real-time per-Codespace cost feed">${escapeHtml(freshness)}</span><button class="btn-header-secondary" id="usageRefreshBtn">Refresh usage</button></div></div>`;
    const links = `<div class="usage-actions"><button class="usage-link" data-usage-url="${LINKS.billing}">Open GitHub billing ↗</button><button class="usage-link" data-usage-url="${LINKS.spending}">Set spending limit ↗</button><button class="usage-link" data-usage-url="${LINKS.codespacesSettings}">Reduce idle timeout ↗</button><button class="usage-link" data-usage-url="${LINKS.docs}">Billing docs ↗</button></div>`;
    if (!u) return `<section class="usage-page" id="usagePage">${head('Usage')}<div class="usage-panel">No active GitHub account.</div></section>`;
    const title = `Usage · ${escapeHtml(u.login || u.account)}${u.plan ? ' · ' + escapeHtml(u.plan.label) : ''}`;
    if (u.mode === 'needsPermission') {
        return `<section class="usage-page" id="usagePage">${head(title)}<div class="usage-panel" style="display:flex;justify-content:space-between;align-items:center;gap:12px;"><div><b>Usage needs permission.</b> <span class="usage-muted">GitHub's billing API needs the "user" scope for ${escapeHtml(u.account)}.</span></div><button class="btn-new-cs" data-usage-grant="${escapeHtml(u.account)}">Grant access</button></div></section>`;
    }
    if (u.mode === 'orgBilled' || !hasData(u)) {
        return `<section class="usage-page" id="usagePage">${head(title)}<div class="usage-panel">${u.mode === 'orgBilled' ? 'Billed to ' + escapeHtml((u.orgBilled || []).join(', ')) : errorBodyHtml(u) + (u.fix ? `<div class="usage-muted" style="margin-top:6px;">Run it in a terminal, then Refresh usage.</div>` : '')}</div>${links}</section>`;
    }
    const s = u.stats, a = u.analytics, d = u.dollars;
    const proj = projectionText(u);
    const forecastSub = a ? (a.projectionLabel === 'runs out' && a.runOutDate ? `by ${escapeHtml(fmtDate(u.resetDate))} · runs out ~${escapeHtml(fmtDate(a.runOutDate))}` : a.projectionLabel === "won't run out before reset" ? `by ${escapeHtml(fmtDate(u.resetDate))} · won't run out` : escapeHtml(a.projectionLabel)) : escapeHtml(s.daysLeftLabel);
    const tiles = [
        tile('CORE-HOURS USED', `${n1(s.used)} / ${s.quota}`, 'From the billing summary API: compute grossQuantity (machine-hours) × cores of the SKU. Remaining = quota − used (derived)', `${n1(s.remaining)} left${u.compute ? ' · ' + money(u.compute.amount) + ' of ' + money(u.compute.quotaValue) : ''}`),
        tile('AVG / DAY', d1(s.avgPerDay), `Derived: core-hrs in the last ${s.avgWindowDays || 7} day(s) ÷ ${s.avgWindowDays || 7}`, a ? `cycle avg ${d1(a.avgCycle)}` : 'last 7 days', true),
        tile('FORECAST', a && a.projectedEnd != null && a.projectionLabel !== 'Closed month' ? `~${n1(a.projectedEnd)} / ${s.quota}` : escapeHtml(daysLeftValue(s)), PROJECTION_TIP + ' Days left = remaining ÷ last-7-day average.', forecastSub, true),
        tile('STORAGE', u.storage && u.storage.used != null ? `${n1(u.storage.used)} / ${u.storage.quota}` : '—', 'From the billing summary API: storage grossQuantity (GB-month)', u.storage && u.storage.amount != null ? 'GB-month · ' + money(u.storage.amount) + ' of ' + money(u.storage.quotaValue) : 'GB-month')
    ].join('');
    const quotaExtra = `<div class="usage-qfacts">${d ? `<div title="From the billing summary API: netAmount (what you pay after the included discount)"><span class="usage-muted">Billable</span><b>${money(d.billable)}</b><span class="usage-muted">${money(d.consumed)} consumed</span></div>` : ''}<div title="Personal accounts: quotas reset at the start of each calendar month (UTC)"><span class="usage-muted">Resets</span><b>${escapeHtml(fmtDate(u.resetDate))}</b><span class="usage-muted">${a ? n1(a.daysRemaining) + ' days away' : ''}</span></div></div>`;

    // Remaining clock hours per machine size
    const machines = a ? `<div class="usage-panel"><h3>Hours left by machine size <span class="usage-derived">derived</span></h3>
<div class="usage-chips">${a.remainingByMachine.map(m => `<div class="usage-chip" title="Derived: ${n1(s.remaining)} remaining core-hrs ÷ ${m.cores} cores. Paid rate ${money(m.pricePerHour)}/h"><span class="usage-muted">${m.cores}-core</span><b>${d1(m.hours)} h</b></div>`).join('')}</div>
<div class="usage-muted" style="margin-top:8px;">Core-hours = cores × hours, so a 4-core machine uses your quota 2× as fast as a 2-core, and an 8-core 4× as fast.${u.skus && u.skus.length ? ' This month: ' + u.skus.map(k => `${k.cores}-core ${n1(k.coreHours)} core-hrs`).join(', ') + '.' : ''}</div></div>` : '';

    // MoM
    const warnNote = (t) => `<div class="usage-warn-note" role="status"><span aria-hidden="true">⚠️</span> <b>Warning</b> ${escapeHtml(t)}</div>`;
    const dailyNote = u.dailyError ? warnNote(`${u.dailyError}. Daily charts and the per-repository table are unavailable; the totals above come from the billing summary.`) : '';
    const mom = !u.mom && u.prevError ? `<div class="usage-panel"><h3>Compared with the previous month</h3>${warnNote(`${u.prevError}, so the comparison can't be shown.`)}</div>` : u.mom ? `<div class="usage-panel"><h3>Compared with ${escapeHtml(new Date(Date.UTC(u.prevPeriod.year, u.prevPeriod.month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }))}${u.isCurrent ? ' <span class="usage-muted" style="text-transform:none;letter-spacing:0;">(this month is still in progress)</span>' : ''}</h3>
<div class="usage-mom">
<div><div class="usage-muted">Compute</div><b>${n1(u.mom.coreHours.current)}</b> vs ${n1(u.mom.coreHours.previous)} core-hrs<br>${deltaHtml(u.mom.coreHours, 'core-hrs')}</div>
<div><div class="usage-muted">Storage</div><b>${n2(u.mom.storageGbMonths.current)}</b> vs ${n2(u.mom.storageGbMonths.previous)} GB-month<br>${deltaHtml(u.mom.storageGbMonths, 'GB-month')}</div>
<div><div class="usage-muted">Consumed</div><b>${money(u.mom.consumed.current)}</b> vs ${money(u.mom.consumed.previous)}<br>${deltaHtml(u.mom.consumed, '', true)}</div>
<div><div class="usage-muted">Billable</div><b>${money(u.mom.billable.current)}</b> vs ${money(u.mom.billable.previous)}<br>${deltaHtml(u.mom.billable, '', true)}</div>
</div></div>` : '';

    // Storage panel with tip (no delete action)
    const topSt = (u.storageRows || [])[0];
    const storagePanel = `<div class="usage-panel"><h3>Storage · ${u.storage && u.storage.used != null ? `${n1(u.storage.used)} / ${u.storage.quota} GB-month (from GitHub billing)` : 'Not available — GitHub billing API did not return storage'}</h3>
${a && (u.storageSeries || []).length ? `<div class="usage-spark" title="GB-month accrued per day (hover a bar for the day and $)">${barChartSvg(u.storageSeries, { unit: 'GB-month', color: 'var(--hub-purple-icon)', label: 'Daily storage GB-month sparkline', digits: 3, height: 44 })}<span class="usage-muted">GB-month per day</span></div>` : ''}
${topSt ? `<div class="usage-proj">Most storage this month: <b>${escapeHtml(topSt.repo)}</b> — ${n2(topSt.storageGbMonths)} GB-month (${money(topSt.amount)}).</div>` : ''}
<div class="usage-muted" style="margin-top:6px;">Storage is billed for every codespace that exists, including stopped ones, until it is deleted (<button class="usage-link" data-usage-url="${LINKS.storageDocs}">GitHub docs ↗</button>). Stopping a codespace only stops compute charges.</div>
${u.orgBilledUnknown ? warnNote("Couldn't load your codespaces list, so it's unknown whether some are billed to an organization.") : ''}
${u.orgBilled && u.orgBilled.length ? `<div class="usage-muted" style="margin-top:6px;">Some codespaces are billed to ${escapeHtml(u.orgBilled.join(', '))} and are not counted.</div>` : ''}</div>`;

    // Charts
    let charts = '';
    if (a) {
        const series = a.series;
        const lastIdx = Math.max(0, series.findIndex(p => p.future) === -1 ? series.length - 1 : series.findIndex(p => p.future) - 1);
        const last7 = series.slice(Math.max(0, lastIdx - 6), lastIdx + 1);
        const ideal = s.quota ? s.quota / a.totalDays : 0;
        const st = u.storageSeries || [];
        const stLast7 = st.slice(Math.max(0, lastIdx - 6), lastIdx + 1);
        const seg = (id) => `<span class="usage-seg" role="group" aria-label="Chart range"><button data-range="${id}" data-r="30" aria-pressed="true">Month</button><button data-range="${id}" data-r="7" aria-pressed="false">7 days</button></span>`;
        charts = `<div class="usage-grid2">
<div class="usage-panel usage-chart-wrap"><h3>Compute · core-hrs per day ${seg('c')}</h3>
<div data-chart="c" data-r="30">${barChartSvg(series, { unit: 'core-hrs', idealPerDay: ideal, label: 'Daily compute core-hours for the month' })}</div>
<div data-chart="c" data-r="7" class="usage-hidden">${barChartSvg(last7, { unit: 'core-hrs', idealPerDay: ideal, label: 'Daily compute core-hours, last 7 days' })}</div>
<div class="usage-legend"><span><i style="background:var(--hub-accent)"></i>core-hrs/day (hover for hours and $)</span><span><i style="background:var(--hub-warning)"></i>pace that uses the quota exactly at reset</span></div>
<div class="usage-daystats">
<span title="Highest single day this month">Peak: <b>${a.peak ? `${n2(a.peak.value)} core-hrs on ${escapeHtml(fmtDayKey(a.peak.date))} (${money(a.peak.amount)})` : '—'}</b></span>
<span title="Days with any compute usage">Active days: <b>${a.activeDays} / ${a.elapsedDays}</b></span>
${a.today ? `<span title="Today (UTC). Daily rows can lag a few hours">Today: <b>${n2(a.today.value)} core-hrs (${money(a.today.amount)})</b></span>` : ''}
</div></div>
<div class="usage-panel"><h3>Cumulative vs pace</h3>${cumulativeSvg(series, s.quota)}
<div class="usage-legend"><span><i style="background:var(--hub-accent)"></i>cumulative core-hrs</span><span><i style="background:var(--hub-warning)"></i>ideal pace</span><span><i style="background:var(--hub-danger)"></i>quota</span></div>
${proj ? `<div class="usage-proj" style="margin-top:6px;" title="${escapeHtml(PROJECTION_TIP)}">${escapeHtml(proj)}<span class="usage-derived">derived</span></div>` : ''}</div>
<div class="usage-panel"><h3>Included quotas</h3><div style="display:flex;flex-direction:column;gap:10px;">${quotaBarsHtml(u, opts)}</div>${quotaExtra}<div style="margin-top:8px;">${billingLineHtml(u)}</div></div>
${storagePanel}
</div>`;
    } else {
        charts = `<div class="usage-panel"><h3>Included quotas</h3><div style="display:flex;flex-direction:column;gap:10px;">${quotaBarsHtml(u, opts)}</div>${quotaExtra}<div style="margin-top:8px;">${billingLineHtml(u)}</div></div>
<div class="usage-panel"><h3>Daily usage</h3>${chartSvg(u)}<div class="usage-muted">Bars: core-hours per day · dashed line: pace that uses the quota exactly at reset</div></div>`;
    }

    // Per-repository table with expandable SKU breakdown
    const repos = u.repos || [];
    const totalDays = a ? a.totalDays : 30;
    const rows = repos.map((r, i) => {
        const detail = `<tr class="usage-detail usage-hidden" id="usageDetail${i}"><td colspan="6"><div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;">
<table class="usage-table" style="width:auto;min-width:340px;"><thead><tr><th scope="col">SKU</th><th scope="col" class="num">Quantity</th><th scope="col" class="num">Core-hrs / GB-mo</th><th scope="col" class="num">Amount</th></tr></thead><tbody>
${(r.skus || []).map(k => `<tr><td>${escapeHtml(k.sku)}${k.cores ? ` <span class="usage-muted">(${k.cores}-core)</span>` : ''}</td><td class="num">${n2(k.quantity)} ${escapeHtml(k.unitType || '')}</td><td class="num">${k.kind === 'storage' ? n2(k.gbMonths) + ' GB-mo' : n2(k.coreHours) + ' core-hrs'}</td><td class="num">${money(k.amount)}</td></tr>`).join('') || '<tr><td colspan="4" class="usage-muted">No SKU rows.</td></tr>'}
</tbody></table>
<div><div class="usage-muted">Daily compute (core-hrs)</div>${sparklineSvg(r.daily, u.cycleStart, totalDays)}</div></div></td></tr>`;
        return `<tr class="usage-repo-row" data-repo="${escapeHtml(String(r.repo).toLowerCase())}"><td><button class="usage-expand" aria-expanded="false" aria-controls="usageDetail${i}" aria-label="Show SKU breakdown for ${escapeHtml(r.repo)}">▸</button>${escapeHtml(r.repo)}</td><td class="num" data-v="${r.coreHours}">${n1(r.coreHours)}</td><td class="num" data-v="${r.storageGbMonths == null ? -1 : r.storageGbMonths}">${r.storageGbMonths == null ? '—' : n2(r.storageGbMonths)}</td><td class="num" data-v="${r.share}">${n1(r.share)}%</td><td class="num" data-v="${r.computeAmount != null ? r.computeAmount : r.amount}">${r.computeAmount != null ? money(r.computeAmount) + ' / ' + money(r.storageAmount) : '—'}</td><td class="num" data-v="${r.amount}">${money(r.amount)}</td></tr>${detail}`;
    }).join('') || '<tr><td colspan="6" class="usage-muted">No usage recorded this cycle yet.</td></tr>';
    // Use the API total (avoids $0.01 drift from summing rounded per-repo amounts).
    const total = u.dollars ? u.dollars.consumed : repos.reduce((t, r) => t + (Number(r.amount) || 0), 0);
    const foot = repos.length ? `<tfoot><tr><td>Total</td><td class="num">${n1(repos.reduce((t, r) => t + r.coreHours, 0))}</td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num">${money(total)}</td></tr></tfoot>` : '';
    const repoPanel = `<div class="usage-panel"><h3>Per repository <span class="usage-actions"><input class="usage-filter" id="usageRepoFilter" type="search" placeholder="Filter repositories…" aria-label="Filter repositories"><button class="btn-header-secondary" data-usage-export="csv">Export CSV</button><button class="btn-header-secondary" data-usage-export="json">Export JSON</button></span></h3>
<div class="usage-scroll"><table class="usage-table sortable" id="usageRepoTable"><thead><tr><th scope="col">Repository</th><th scope="col" class="num">Core-hours</th><th scope="col" class="num">Storage GB-mo</th><th scope="col" class="num">Share of $</th><th scope="col" class="num">Compute / storage $</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${rows}</tbody>${foot}</table></div>
${u.dailyGapCoreHours > 0.05 ? `<div class="usage-muted" style="margin-top:6px;">Daily rows currently add up to ${n1(s.used - u.dailyGapCoreHours)} core-hrs; the summary reports ${n1(s.used)}. GitHub's daily rows can trail the summary by a few hours.</div>` : ''}</div>`;

    const storageTail = a ? '' : storagePanel;
    return `<section class="usage-page" id="usagePage">${head(title)}
<div class="usage-tiles">${tiles}</div>
${dailyNote}
${machines}
${charts}
${mom}
${repoPanel}
${storageTail}
<div class="usage-panel" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;">${links}<span class="usage-muted">Source: GitHub billing API · dates in UTC · values marked <span class="usage-derived">derived</span> are arithmetic on that data</span></div>
</section>`;
}

/** Script for the Cloud Hub usage parts; expects the hub's `vscode` handle. */
function hubUsageScript(initialPage) {
    return `
(function(){
  const canvas = document.querySelector('.main-canvas');
  const rail = document.getElementById('railUsageBtn');
  function showUsage(on){
    if (!canvas) return;
    canvas.classList.toggle('show-usage', !!on);
    document.querySelectorAll('.rail-link').forEach(l => l.classList.remove('is-active'));
    const target = on ? rail : document.getElementById('railCloudHubBtn');
    if (target) target.classList.add('is-active');
  }
  window.__showUsage = showUsage;
  if (rail) rail.addEventListener('click', () => showUsage(true));
  document.querySelectorAll('.rail-link:not(#railUsageBtn)').forEach(l => l.addEventListener('click', () => { if (canvas && canvas.classList.contains('show-usage')) showUsage(false); }));
  const hero = document.getElementById('usageHero');
  if (hero) { hero.addEventListener('click', () => showUsage(true)); hero.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showUsage(true); } }); }
  document.querySelectorAll('[data-usage-grant]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ command: 'usageGrant', account: b.getAttribute('data-usage-grant') }); }));
  document.querySelectorAll('[data-usage-signin]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ command: 'loginGitHub' }); }));
  const rb = document.getElementById('usageRefreshBtn');
  if (rb) rb.addEventListener('click', () => vscode.postMessage({ command: 'usageRefresh' }));
  const ms = document.getElementById('usageMonth');
  if (ms) ms.addEventListener('change', () => { const p = ms.value.split('-'); vscode.postMessage({ command: 'usageMonth', year: Number(p[0]), month: Number(p[1]) }); });
  document.querySelectorAll('[data-usage-url]').forEach(b => b.addEventListener('click', () => vscode.postMessage({ command: 'usageOpenUrl', url: b.getAttribute('data-usage-url') })));
  document.querySelectorAll('[data-usage-export]').forEach(b => b.addEventListener('click', () => vscode.postMessage({ command: 'usageExport', format: b.getAttribute('data-usage-export') })));
  document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    const id = b.getAttribute('data-range'), r = b.getAttribute('data-r');
    document.querySelectorAll('[data-range="' + id + '"]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('[data-chart="' + id + '"]').forEach(c => c.classList.toggle('usage-hidden', c.getAttribute('data-r') !== r));
  }));
  document.querySelectorAll('.usage-expand').forEach(b => b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open)); b.textContent = open ? '▾' : '▸';
    const d = document.getElementById(b.getAttribute('aria-controls')); if (d) d.classList.toggle('usage-hidden', !open);
  }));
  const f = document.getElementById('usageRepoFilter');
  if (f) f.addEventListener('input', () => {
    const q = f.value.trim().toLowerCase();
    document.querySelectorAll('#usageRepoTable tr.usage-repo-row').forEach(r => {
      const hide = q && !(r.getAttribute('data-repo') || '').includes(q);
      r.classList.toggle('usage-hidden', !!hide);
      const btn = r.querySelector('.usage-expand'); const d = btn && document.getElementById(btn.getAttribute('aria-controls'));
      if (d && hide) d.classList.add('usage-hidden');
      if (d && !hide && btn.getAttribute('aria-expanded') === 'true') d.classList.remove('usage-hidden');
    });
  });
  document.querySelectorAll('table.sortable').forEach(t => t.querySelectorAll('thead th').forEach((th, i) => { let asc = false; th.setAttribute('tabindex', '0'); const sort = () => { asc = !asc; t.querySelectorAll('thead th').forEach(x => x.removeAttribute('aria-sort')); th.setAttribute('aria-sort', asc ? 'ascending' : 'descending'); const tb = t.tBodies[0]; const rows = [...tb.querySelectorAll(':scope > tr:not(.usage-detail)')]; rows.sort((a, b) => { const ca = a.cells[i], cb = b.cells[i]; if (!ca || !cb) return 0; const va = ca.dataset.v != null ? parseFloat(ca.dataset.v) : ca.textContent.trim().toLowerCase(), vb = cb.dataset.v != null ? parseFloat(cb.dataset.v) : cb.textContent.trim().toLowerCase(); return (va > vb ? 1 : va < vb ? -1 : 0) * (asc ? 1 : -1); }); rows.forEach(r => { tb.appendChild(r); const btn = r.querySelector('.usage-expand'); const d = btn && document.getElementById(btn.getAttribute('aria-controls')); if (d) tb.appendChild(d); }); }; th.addEventListener('click', sort); th.addEventListener('keydown', (e) => { if (e.key === 'Enter') sort(); }); }));
  window.addEventListener('message', (ev) => { if (ev.data && ev.data.command === 'showUsage') showUsage(true); });
  ${initialPage === 'usage' ? 'showUsage(true);' : ''}
})();`;
}

module.exports = {
    sidebarSummaryHtml, buildSidebarUsageScript,
    hubUsageCardHtml, hubUsagePageHtml, hubUsageScript, storageTierText, chartSvg, barChartSvg, cumulativeSvg, sparklineSvg, HUB_CSS,
    daysLeftShort, daysLeftValue, projectionText, LINKS
};
