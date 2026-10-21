/**
 * HTML builders for Codespaces usage analytics (active gh account only).
 *  - Sidebar: one compact summary under the account picker.
 *  - Cloud Hub dashboard: one full-width usage card above the KPI grid, plus
 *    a "Usage" page reachable from the left rail.
 * Pure functions (no vscode import) so they are unit-testable.
 * Dashboard parts use the Cloud Hub design tokens (--hub-*); sidebar parts
 * use VS Code theme variables.
 */
const { escapeHtml } = require('./utils');

function fmtTime(ms) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }); } catch { return ''; }
}
function n1(v) { return (Math.round((Number(v) || 0) * 10) / 10).toString(); }
function money(v) { return '$' + (Number(v) || 0).toFixed(2); }
function hasData(u) { return !!(u && u.stats && (u.mode === 'live' || u.mode === 'estimated')); }
function daysLeftShort(s) {
    if (!s) return '—';
    if (s.daysLeftLabel.startsWith('about')) return '~' + Math.max(0, Math.floor(s.daysLeft)) + ' days left';
    return s.daysLeftLabel;
}
function daysLeftValue(s) {
    if (!s) return '—';
    if (s.daysLeftLabel.startsWith('about')) return String(Math.max(0, Math.floor(s.daysLeft)));
    if (s.daysLeftLabel === 'lasts the full cycle') return 'Full cycle';
    if (s.daysLeftLabel === 'quota used up') return '0';
    return '—';
}

// ── Sidebar ────────────────────────────────────────────────────────────────

const SIDEBAR_CSS = `
.usage-mini{margin:6px 10px 2px;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:11px;color:var(--vscode-foreground);border:1px solid var(--vscode-widget-border, var(--vscode-panel-border))}
.usage-mini:hover{background:var(--vscode-list-hoverBackground)}
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

/** Compact sidebar summary for the active account (or '' when nothing to show). */
function sidebarSummaryHtml(u, nonce) {
    if (!u) return '';
    const acc = escapeHtml(u.account);
    const plan = u.plan ? ` · ${escapeHtml(u.plan.label)}` : '';
    const tags = (u.mode === 'estimated' ? `<span class="usage-mini-tag" title="${escapeHtml(u.estimatedReason || 'Estimated')}">Estimated</span>` : '')
        + (u.offline ? `<span class="usage-mini-tag" title="Network unavailable">offline · ${fmtTime(u.lastUpdated || u.fetchedAt)}</span>` : '');
    const top = `<div class="usage-mini-top"><span>Usage${plan}</span>${tags}</div>`;
    let body;
    if (u.mode === 'needsPermission') {
        body = `<div class="usage-mini-line">Grant access to see usage · <button class="usage-mini-link" data-usage-grant="${acc}">Grant access</button></div>`;
    } else if (u.mode === 'orgBilled') {
        body = `<div class="usage-mini-line">Billed to ${escapeHtml((u.orgBilled || []).join(', ') || 'organization')}</div>`;
    } else if (hasData(u)) {
        const s = u.stats;
        body = `<div class="usage-mini-bar"><div class="usage-mini-fill ${s.level}" style="width:${Math.min(100, s.pct)}%"></div></div>
<div class="usage-mini-line">${n1(s.used)} / ${s.quota} core-hrs · ${escapeHtml(daysLeftShort(s))}</div>`;
    } else {
        body = `<div class="usage-mini-line">Usage unavailable</div>`;
    }
    return `<style nonce="${nonce}">${SIDEBAR_CSS}</style><div class="usage-mini" data-usage-open="${acc}" title="Open Codespaces usage in Cloud Hub">${top}${body}</div>`;
}

/** Click wiring; placed AFTER the sidebar's main script (reuses its `vscode` handle). */
function buildSidebarUsageScript(nonce) {
    return `<script nonce="${nonce}">(function(){const vs=(typeof vscode!=='undefined')?vscode:acquireVsCodeApi();
document.querySelectorAll('[data-usage-grant]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();vs.postMessage({command:'usageGrantAccess',account:b.getAttribute('data-usage-grant')});}));
document.querySelectorAll('[data-usage-open]').forEach(c=>c.addEventListener('click',()=>vs.postMessage({command:'openUsageDashboard'})));})();</script>`;
}

// ── Cloud Hub dashboard ────────────────────────────────────────────────────

const HUB_CSS = `
.usage-hero{background:var(--hub-bg-card);border:1px solid var(--hub-border);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:16px;box-shadow:var(--shadow-card);cursor:pointer}
.usage-hero:hover{border-color:var(--hub-accent)}
.usage-hero .kpi-icon-box{background:var(--hub-accent-soft);color:var(--hub-accent)}
.usage-hero-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.usage-hero-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.usage-bar{height:6px;border-radius:3px;background:var(--hub-border-subtle);overflow:hidden;max-width:520px}
.usage-fill{height:100%;background:var(--hub-accent);border-radius:3px}
.usage-fill.amber{background:var(--hub-warning)}
.usage-fill.red{background:var(--hub-danger)}
.usage-hero-figure{font-size:15px;font-weight:700;color:var(--hub-text-main)}
.usage-hero-figure small{font-size:12px;font-weight:500;color:var(--hub-text-muted)}
.usage-hero-side{display:flex;gap:22px;flex-shrink:0}
.usage-stat{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.usage-stat .kpi-value{font-size:20px}
.usage-tag{font-size:10px;font-weight:600;padding:1px 7px;border-radius:10px;background:var(--hub-warning-soft);color:var(--hub-warning);text-transform:none;letter-spacing:0}
.usage-tag.off{background:var(--hub-danger-soft);color:var(--hub-danger-text)}
.usage-muted{font-size:11px;color:var(--hub-text-muted)}
.usage-page{display:none;flex-direction:column;gap:14px}
.main-canvas.show-usage > section:not(.usage-page){display:none !important}
.main-canvas.show-usage > .usage-page{display:flex}
.usage-panel{background:var(--hub-bg-card);border:1px solid var(--hub-border);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow-card)}
.usage-panel h3{font-size:12px;font-weight:600;color:var(--hub-text-muted);text-transform:uppercase;letter-spacing:.5px;margin:0 0 10px}
.usage-tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
.usage-tile{background:var(--hub-bg-card);border:1px solid var(--hub-border);border-radius:12px;padding:12px 14px;box-shadow:var(--shadow-card);display:flex;flex-direction:column;gap:2px}
.usage-tile .kpi-value{font-size:20px}
.usage-table{width:100%;border-collapse:collapse;font-size:12px}
.usage-table th{text-align:left;font-weight:600;color:var(--hub-text-muted);padding:6px 8px;border-bottom:1px solid var(--hub-border);cursor:pointer;user-select:none}
.usage-table td{padding:6px 8px;border-bottom:1px solid var(--hub-border-subtle);color:var(--hub-text-main)}
.usage-table td.num,.usage-table th.num{text-align:right}
.usage-page-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.usage-page-head h2{font-size:16px;margin:0;color:var(--hub-text-main)}
@media (max-width: 900px){.usage-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.usage-hero{flex-wrap:wrap}}
`;

function tagsHtml(u) {
    return (u.mode === 'estimated' ? `<span class="usage-tag" title="${escapeHtml(u.estimatedReason || 'Estimated')}">Estimated</span>` : '')
        + (u.offline ? `<span class="usage-tag off">offline · last updated ${fmtTime(u.lastUpdated || u.fetchedAt)}</span>` : '');
}

/** Full-width usage card shown above the Cloud Hub KPI grid. */
function hubUsageCardHtml(u, icon = '') {
    if (!u) return '';
    const head = `<div class="usage-hero-head"><span class="kpi-label">USAGE · ${escapeHtml(u.login || u.account)}${u.plan ? ' · ' + escapeHtml(u.plan.label) : ''}</span>${tagsHtml(u)}</div>`;
    const iconBox = `<div class="kpi-icon-box">${icon}</div>`;
    if (u.mode === 'needsPermission') {
        return `<section class="usage-hero" id="usageHero">${iconBox}<div class="usage-hero-main">${head}<div class="usage-hero-figure">Usage needs permission <small>GitHub's billing API needs the "user" scope</small></div></div><button class="btn-new-cs" data-usage-grant="${escapeHtml(u.account)}">Grant access</button></section>`;
    }
    if (u.mode === 'orgBilled') {
        return `<section class="usage-hero" id="usageHero">${iconBox}<div class="usage-hero-main">${head}<div class="usage-hero-figure">Billed to ${escapeHtml((u.orgBilled || []).join(', ') || 'organization')}</div></div></section>`;
    }
    if (!hasData(u)) {
        return `<section class="usage-hero" id="usageHero">${iconBox}<div class="usage-hero-main">${head}<div class="usage-hero-figure">Usage unavailable <small>${escapeHtml(u.error || '')}</small></div></div></section>`;
    }
    const s = u.stats;
    return `<section class="usage-hero" id="usageHero" title="Open usage details">${iconBox}
<div class="usage-hero-main">${head}
<div class="usage-bar"><div class="usage-fill ${s.level}" style="width:${Math.min(100, s.pct)}%"></div></div>
<div class="usage-hero-figure">${n1(s.used)} / ${s.quota} <small>core-hrs this cycle · resets ${escapeHtml(fmtDate(u.resetDate))}</small></div></div>
<div class="usage-hero-side">
<div class="usage-stat"><span class="kpi-label">HOURS LEFT</span><span class="kpi-value">${n1(s.remaining)}</span></div>
<div class="usage-stat"><span class="kpi-label">DAYS LEFT</span><span class="kpi-value" title="${escapeHtml(s.daysLeftLabel)}${s.avgPerDay ? ' at ' + n1(s.avgPerDay) + ' core-hrs/day' : ''}">${escapeHtml(daysLeftValue(s))}</span></div>
</div></section>`;
}

/** Value for the existing Storage Tier KPI card. */
function storageTierText(u) {
    if (hasData(u) && u.storage && u.storage.quota) return `${n1(u.storage.used)} / ${u.storage.quota} GB-month`;
    return '15 GB Free Tier';
}

/** Daily bar chart (inline SVG) with dashed ideal-pace line. */
function chartSvg(u) {
    const start = new Date(u.cycleStart), reset = new Date(u.resetDate);
    const days = Math.max(1, Math.round((reset - start) / 86400000));
    const vals = [];
    for (let i = 0; i < days; i++) {
        const key = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
        vals.push({ key, v: (u.daily && u.daily[key]) || 0 });
    }
    const ideal = u.stats && u.stats.quota ? u.stats.quota / days : 0;
    const max = Math.max(1, ideal * 1.3, ...vals.map(x => x.v));
    const W = 600, H = 140, bw = W / days;
    const bars = vals.map((x, i) => {
        const h = (x.v / max) * (H - 16);
        return `<rect x="${(i * bw + 1.5).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(1, bw - 3).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="var(--hub-accent)"><title>${x.key}: ${n1(x.v)} core-hours</title></rect>`;
    }).join('');
    const iy = (H - (ideal / max) * (H - 16)).toFixed(1);
    const line = ideal ? `<line x1="0" x2="${W}" y1="${iy}" y2="${iy}" stroke="var(--hub-warning)" stroke-width="1.5" stroke-dasharray="5 4"><title>Ideal pace: ${n1(ideal)} core-hours/day</title></line>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="Daily core-hours">${bars}${line}</svg>`;
}

/** The "Usage" page (hidden until the rail item / usage card is clicked). */
function hubUsagePageHtml(u) {
    const head = (title) => `<div class="usage-page-head"><h2>${title}</h2><div style="display:flex;gap:8px;align-items:center;">${u ? tagsHtml(u) : ''}<span class="usage-muted">Updated hourly · last fetched ${u && u.fetchedAt ? fmtTime(u.fetchedAt) : '—'}</span><button class="btn-header-secondary" id="usageRefreshBtn">Refresh usage</button></div></div>`;
    if (!u) return `<section class="usage-page" id="usagePage">${head('Usage')}<div class="usage-panel">No active GitHub account.</div></section>`;
    const title = `Usage · ${escapeHtml(u.login || u.account)}${u.plan ? ' · ' + escapeHtml(u.plan.label) : ''}`;
    if (u.mode === 'needsPermission') {
        return `<section class="usage-page" id="usagePage">${head(title)}<div class="usage-panel" style="display:flex;justify-content:space-between;align-items:center;gap:12px;"><div><b>Usage needs permission.</b> <span class="usage-muted">GitHub's billing API needs the "user" scope for ${escapeHtml(u.account)}.</span></div><button class="btn-new-cs" data-usage-grant="${escapeHtml(u.account)}">Grant access</button></div></section>`;
    }
    if (u.mode === 'orgBilled' || !hasData(u)) {
        return `<section class="usage-page" id="usagePage">${head(title)}<div class="usage-panel">${u.mode === 'orgBilled' ? 'Billed to ' + escapeHtml((u.orgBilled || []).join(', ')) : 'Usage unavailable' + (u.error ? ': ' + escapeHtml(u.error) : '')}</div></section>`;
    }
    const s = u.stats;
    const tiles = [
        ['CORE-HOURS USED', `${n1(s.used)} / ${s.quota}`],
        ['REMAINING', n1(s.remaining)],
        ['AVG / DAY', n1(s.avgPerDay)],
        ['DAYS LEFT', escapeHtml(daysLeftValue(s))],
        ['RESETS', escapeHtml(fmtDate(u.resetDate))]
    ].map(([k, v]) => `<div class="usage-tile"><span class="kpi-label">${k}</span><span class="kpi-value">${v}</span></div>`).join('');
    const rows = (u.machines || []).map(m => `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.repo || '')}</td><td data-v="${m.cores || 0}">${m.cores ? m.cores + '-core' : escapeHtml(m.machine || '—')}</td><td class="num" data-v="${m.coreHours}">${n1(m.coreHours)}</td><td class="num" data-v="${m.share}">${n1(m.share)}%</td><td class="num" data-v="${m.estCost}">${money(m.estCost)}</td></tr>`).join('') || '<tr><td colspan="6" class="usage-muted">No usage recorded this cycle yet.</td></tr>';
    const storage = (u.storageRows || []).map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.repo || '')}</td><td class="num">${r.storageGb != null ? n1(r.storageGb) + ' GB' : '—'}</td></tr>`).join('') || '<tr><td colspan="3" class="usage-muted">No codespaces.</td></tr>';
    return `<section class="usage-page" id="usagePage">${head(title)}
<div class="usage-tiles">${tiles}</div>
<div class="usage-panel"><h3>Daily usage</h3>${chartSvg(u)}<div class="usage-muted">Bars: core-hours per day · dashed line: pace that uses the quota exactly at reset</div></div>
<div class="usage-panel"><h3>Per machine</h3><table class="usage-table sortable"><thead><tr><th>Codespace</th><th>Repo</th><th>Machine</th><th class="num">Core-hours</th><th class="num">Share</th><th class="num">Est. $</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="usage-panel"><h3>Storage · ${n1(u.storage && u.storage.used)} / ${u.storage ? u.storage.quota : 0} GB-month · ${money(u.billed)} billed</h3><table class="usage-table"><thead><tr><th>Codespace</th><th>Repo</th><th class="num">Size</th></tr></thead><tbody>${storage}</tbody></table>${u.orgBilled && u.orgBilled.length ? `<div class="usage-muted" style="margin-top:6px;">Some codespaces are billed to ${escapeHtml(u.orgBilled.join(', '))} and are not counted.</div>` : ''}</div>
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
  if (hero) hero.addEventListener('click', () => showUsage(true));
  document.querySelectorAll('[data-usage-grant]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); vscode.postMessage({ command: 'usageGrant', account: b.getAttribute('data-usage-grant') }); }));
  const rb = document.getElementById('usageRefreshBtn');
  if (rb) rb.addEventListener('click', () => vscode.postMessage({ command: 'usageRefresh' }));
  document.querySelectorAll('table.sortable').forEach(t => t.querySelectorAll('th').forEach((th, i) => { let asc = false; th.addEventListener('click', () => { asc = !asc; const tb = t.tBodies[0]; const rows = [...tb.rows]; rows.sort((a, b) => { const ca = a.cells[i], cb = b.cells[i]; if (!ca || !cb) return 0; const va = ca.dataset.v != null ? parseFloat(ca.dataset.v) : ca.textContent, vb = cb.dataset.v != null ? parseFloat(cb.dataset.v) : cb.textContent; return (va > vb ? 1 : va < vb ? -1 : 0) * (asc ? 1 : -1); }); rows.forEach(r => tb.appendChild(r)); }); }));
  window.addEventListener('message', (ev) => { if (ev.data && ev.data.command === 'showUsage') showUsage(true); });
  ${initialPage === 'usage' ? 'showUsage(true);' : ''}
})();`;
}

module.exports = {
    sidebarSummaryHtml, buildSidebarUsageScript,
    hubUsageCardHtml, hubUsagePageHtml, hubUsageScript, storageTierText, chartSvg, HUB_CSS,
    daysLeftShort, daysLeftValue
};
