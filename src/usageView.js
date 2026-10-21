/**
 * HTML builders for usage analytics (sidebar cards + dashboard webview).
 * Pure functions: no vscode import, so they are unit-testable.
 * Styling uses VS Code theme CSS variables only (works in light + dark).
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

const USAGE_CSS = `
.usage-card{margin:6px 8px;padding:8px 10px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-sideBar-background);cursor:pointer;font-size:11px;color:var(--vscode-foreground)}
.usage-card:hover{background:var(--vscode-list-hoverBackground)}
.usage-head{display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:5px}
.usage-tag{font-size:9px;padding:1px 5px;border-radius:8px;border:1px solid var(--vscode-editorWarning-foreground);color:var(--vscode-editorWarning-foreground)}
.usage-bar{height:6px;border-radius:3px;background:var(--vscode-progressBar-background);opacity:1;overflow:hidden;background:var(--vscode-editorWidget-border)}
.usage-fill{height:100%;background:var(--vscode-progressBar-background)}
.usage-fill.amber{background:var(--vscode-editorWarning-foreground)}
.usage-fill.red{background:var(--vscode-editorError-foreground)}
.usage-line{margin-top:4px;color:var(--vscode-foreground)}
.usage-sub{margin-top:2px;color:var(--vscode-descriptionForeground);font-size:10px}
.usage-btn{margin-top:6px;padding:3px 8px;border:none;border-radius:3px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-size:11px}
.usage-btn:hover{background:var(--vscode-button-hoverBackground)}
`;

function sidebarCardHtml(u) {
    const plan = u.plan ? u.plan.label : '';
    const head = `<div class="usage-head"><span>${escapeHtml(u.login || u.account)}${plan ? ' · ' + escapeHtml(plan) : ''}</span>${u.mode === 'estimated' ? `<span class="usage-tag" title="${escapeHtml(u.estimatedReason || 'Estimated')}">Estimated</span>` : ''}</div>`;
    const acc = escapeHtml(u.account);
    if (u.mode === 'needsPermission') {
        return `<div class="usage-card" data-usage-account="${acc}">${head}<div class="usage-line">Usage needs permission</div><div class="usage-sub">GitHub's billing API needs the "user" scope for this account.</div><button class="usage-btn" data-usage-grant="${acc}">Grant access</button></div>`;
    }
    if (u.mode === 'orgBilled') {
        return `<div class="usage-card" data-usage-account="${acc}">${head}<div class="usage-line">Billed to ${escapeHtml((u.orgBilled || []).join(', ') || 'organization')}</div></div>`;
    }
    if (u.mode === 'error' || !u.stats) {
        return `<div class="usage-card" data-usage-account="${acc}">${head}<div class="usage-sub">Usage unavailable${u.error ? ': ' + escapeHtml(u.error) : ''}</div></div>`;
    }
    const s = u.stats;
    const pace = s.daysLeftLabel.startsWith('about') ? `${s.daysLeftLabel} at ${n1(s.avgPerDay)} h/day` : s.daysLeftLabel;
    const orgLine = (u.orgBilled && u.orgBilled.length) ? `<div class="usage-sub">Some codespaces billed to ${escapeHtml(u.orgBilled.join(', '))}</div>` : '';
    return `<div class="usage-card" data-usage-account="${acc}" title="Open usage dashboard">${head}
<div class="usage-bar"><div class="usage-fill ${s.level}" style="width:${Math.min(100, s.pct)}%"></div></div>
<div class="usage-line">${n1(s.used)} of ${s.quota} core-hours used · ${n1(s.remaining)} left · ${escapeHtml(pace)}</div>
<div class="usage-sub">Storage ${n1(u.storage && u.storage.used)} of ${u.storage ? u.storage.quota : 0} GB-month · ${money(u.billed)} billed</div>${orgLine}</div>`;
}

function buildSidebarUsageHtml(list, nonce) {
    if (!list || !list.length) return '';
    return `<style nonce="${nonce}">${USAGE_CSS}</style><div class="usage-cards">${list.map(sidebarCardHtml).join('')}</div>
`;
}

/** Click wiring; must be placed AFTER the sidebar's main script (reuses its `vscode` api handle). */
function buildSidebarUsageScript(nonce) {
    return `<script nonce="${nonce}">(function(){const vs=(typeof vscode!=='undefined')?vscode:acquireVsCodeApi();
document.querySelectorAll('[data-usage-grant]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();vs.postMessage({command:'usageGrantAccess',account:b.getAttribute('data-usage-grant')});}));
document.querySelectorAll('[data-usage-account]').forEach(c=>c.addEventListener('click',()=>vs.postMessage({command:'openUsageDashboard',account:c.getAttribute('data-usage-account')})));})();</script>`;
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
    const max = Math.max(1, ideal * 1.2, ...vals.map(x => x.v));
    const W = 600, H = 160, bw = W / days;
    const bars = vals.map((x, i) => {
        const h = (x.v / max) * (H - 20);
        return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="var(--vscode-charts-blue)"><title>${x.key}: ${n1(x.v)} core-hours</title></rect>`;
    }).join('');
    const iy = (H - (ideal / max) * (H - 20)).toFixed(1);
    const line = ideal ? `<line x1="0" x2="${W}" y1="${iy}" y2="${iy}" stroke="var(--vscode-charts-orange)" stroke-dasharray="5 4"><title>Ideal pace: ${n1(ideal)} core-hours/day</title></line>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Daily core-hours">${bars}${line}</svg>`;
}

function accountSection(u) {
    const head = `<h2>${escapeHtml(u.login || u.account)}${u.plan ? ' · ' + escapeHtml(u.plan.label) : ''} ${u.mode === 'estimated' ? `<span class="tag" title="${escapeHtml(u.estimatedReason || '')}">Estimated</span>` : ''}</h2>`;
    if (u.mode === 'needsPermission') return `<section>${head}<p>Usage needs permission (GitHub billing API needs the "user" scope).</p><button data-grant="${escapeHtml(u.account)}">Grant access</button></section>`;
    if (u.mode === 'orgBilled') return `<section>${head}<p>Billed to ${escapeHtml((u.orgBilled || []).join(', '))}</p></section>`;
    if (u.mode === 'error' || !u.stats) return `<section>${head}<p>Usage unavailable${u.error ? ': ' + escapeHtml(u.error) : ''}</p></section>`;
    const s = u.stats;
    const tiles = [
        ['Core-hours used', `${n1(s.used)} / ${s.quota}`],
        ['Remaining', n1(s.remaining)],
        ['Average per day', `${n1(s.avgPerDay)} h`],
        ['Days left', escapeHtml(s.daysLeft != null && s.daysLeftLabel.startsWith('about') ? String(Math.floor(s.daysLeft)) : s.daysLeftLabel)]
    ].map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    const rows = (u.machines || []).map(m => `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.repo || '')}</td><td data-v="${m.cores || 0}">${m.cores ? m.cores + '-core' : escapeHtml(m.machine || '—')}</td><td data-v="${m.coreHours}">${n1(m.coreHours)}</td><td data-v="${m.share}">${n1(m.share)}%</td><td data-v="${m.estCost}">${money(m.estCost)}</td></tr>`).join('') || '<tr><td colspan="6">No usage recorded this cycle yet.</td></tr>';
    const storage = (u.storageRows || []).map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.repo || '')}</td><td>${r.storageGb != null ? n1(r.storageGb) + ' GB' : '—'}</td></tr>`).join('') || '<tr><td colspan="3">No codespaces.</td></tr>';
    return `<section>${head}
<div class="tiles">${tiles}</div>
<p class="muted">Cycle resets ${escapeHtml(fmtDate(u.resetDate))} · Storage ${n1(u.storage && u.storage.used)} of ${u.storage ? u.storage.quota : 0} GB-month · ${money(u.billed)} billed${u.orgBilled && u.orgBilled.length ? ' · Some codespaces billed to ' + escapeHtml(u.orgBilled.join(', ')) : ''}</p>
<h3>Daily usage</h3>${chartSvg(u)}<p class="muted">Bars: core-hours per day · dashed line: pace that uses the quota exactly at reset</p>
<h3>Per machine</h3><table class="sortable"><thead><tr><th>Codespace</th><th>Repo</th><th>Machine</th><th>Core-hours</th><th>Share</th><th>Est. $</th></tr></thead><tbody>${rows}</tbody></table>
<h3>Storage</h3><table><thead><tr><th>Codespace</th><th>Repo</th><th>Size</th></tr></thead><tbody>${storage}</tbody></table></section>`;
}

function buildDashboardHtml(list, nonce, cspSource = '') {
    const fetched = Math.max(0, ...(list || []).map(u => u.fetchedAt || 0));
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:16px;font-size:13px}
.top{display:flex;justify-content:space-between;align-items:center}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:4px 10px;border-radius:3px;cursor:pointer}
button:hover{background:var(--vscode-button-hoverBackground)}
section{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:12px;margin:12px 0}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.tile{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px}
.k{color:var(--vscode-descriptionForeground);font-size:11px}.v{font-size:18px;font-weight:600}
.muted{color:var(--vscode-descriptionForeground);font-size:11px}
.tag{font-size:10px;padding:1px 6px;border-radius:8px;border:1px solid var(--vscode-editorWarning-foreground);color:var(--vscode-editorWarning-foreground)}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--vscode-panel-border)}
th{cursor:pointer;color:var(--vscode-descriptionForeground)}
</style></head><body>
<div class="top"><h1>Codespaces Usage</h1><button id="refresh">Refresh</button></div>
<p class="muted">Updated hourly · last fetched ${fetched ? fmtTime(fetched) : '—'}</p>
${(list || []).map(accountSection).join('') || '<p>No GitHub accounts signed in.</p>'}
<script nonce="${nonce}">(function(){const vs=acquireVsCodeApi();
document.getElementById('refresh').addEventListener('click',()=>vs.postMessage({command:'refresh'}));
document.querySelectorAll('[data-grant]').forEach(b=>b.addEventListener('click',()=>vs.postMessage({command:'grant',account:b.getAttribute('data-grant')})));
document.querySelectorAll('table.sortable').forEach(t=>t.querySelectorAll('th').forEach((th,i)=>{let asc=false;th.addEventListener('click',()=>{asc=!asc;const tb=t.tBodies[0];const rows=[...tb.rows];rows.sort((a,b)=>{const ca=a.cells[i],cb=b.cells[i];if(!ca||!cb)return 0;const va=ca.dataset.v!=null?parseFloat(ca.dataset.v):ca.textContent,vb=cb.dataset.v!=null?parseFloat(cb.dataset.v):cb.textContent;return (va>vb?1:va<vb?-1:0)*(asc?1:-1);});rows.forEach(r=>tb.appendChild(r));});}));})();</script>
</body></html>`;
}

module.exports = { buildSidebarUsageHtml, buildSidebarUsageScript, sidebarCardHtml, buildDashboardHtml, chartSvg };
