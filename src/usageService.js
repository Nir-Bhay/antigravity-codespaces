/**
 * Codespaces usage analytics (core-hours, storage, $) per GitHub account.
 *
 * Data sources (see docs/USAGE_ANALYTICS_RESEARCH.md):
 *  - GET /user                                   -> login + plan.name (+ x-oauth-scopes header)
 *  - GET /user/codespaces                        -> machine.cpus, billable_owner, last_used_at
 *  - GET /users/{u}/settings/billing/usage/summary?product=codespaces (preview, enhanced billing)
 *  - GET /users/{u}/settings/billing/usage        (daily usage lines, repositoryName)
 * The billing endpoints need the `user` scope (fine-grained: "Plan: read").
 * No guessed figures: if they fail we show a clear error with the reason and
 * the gh command; storage only ever comes from the billing API.
 *
 * Every account uses its OWN token (AuthManager.getToken(login) -> native OAuth,
 * stored PAT, or `gh auth token -u <login>`). The active gh account is never
 * switched. Tokens are never logged.
 */

const GITHUB_API_BASE = 'https://api.github.com';
const API_HEADERS = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Antigravity-Codespaces-Pro'
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const PLAN_QUOTAS = {
    free: { label: 'Free', coreHours: 120, storageGb: 15 },
    pro: { label: 'Pro', coreHours: 180, storageGb: 20 }
};
// USD per clock hour, by core count.
const PRICE_PER_HOUR = { 2: 0.18, 4: 0.36, 8: 0.72, 16: 1.44, 32: 2.88 };
const STORAGE_PRICE_PER_GB_MONTH = 0.07;
// Price per core-hour (2-core $0.18/h = 2 x $0.09). Used only to value the included compute quota.
const CORE_HOUR_PRICE = 0.09;

// ── Pure helpers (exported for tests) ──────────────────────────────────────

function round(n, d = 1) {
    const f = Math.pow(10, d);
    return Math.round((Number(n) || 0) * f) / f;
}

function coreHoursFor(cores, hours) {
    return Math.max(0, (Number(cores) || 0) * (Number(hours) || 0));
}

function pricePerHour(cores) {
    const c = Number(cores) || 0;
    if (PRICE_PER_HOUR[c] != null) return PRICE_PER_HOUR[c];
    return round(c * 0.09, 2); // linear: $0.09 per core-hour
}

/**
 * Resolve the quota for an account.
 * @param {string} apiPlanName  plan.name from GET /user (may be empty without `user` scope)
 * @param {{plan?:string, monthlyCoreHours?:number, monthlyStorageGb?:number}} cfg
 */
function resolvePlan(apiPlanName, cfg = {}) {
    const setting = (cfg.plan || 'auto').toLowerCase();
    if (setting === 'custom') {
        return {
            key: 'custom', label: 'Custom', personal: true,
            coreHours: Math.max(0, Number(cfg.monthlyCoreHours) || 0),
            storageGb: Math.max(0, Number(cfg.monthlyStorageGb) || 0)
        };
    }
    if (setting === 'free' || setting === 'pro') {
        return { key: setting, ...PLAN_QUOTAS[setting], personal: true };
    }
    const name = String(apiPlanName || '').toLowerCase();
    if (name === 'pro') return { key: 'pro', ...PLAN_QUOTAS.pro, personal: true };
    if (name === 'free' || !name) return { key: 'free', ...PLAN_QUOTAS.free, personal: true, guessed: !name };
    // team / enterprise / business plans: no personal included quota
    return { key: name, label: name.charAt(0).toUpperCase() + name.slice(1), coreHours: 0, storageGb: 0, personal: false };
}

/** Billing cycle for personal accounts: calendar month (UTC). */
function billingCycle(now = new Date()) {
    const d = new Date(now);
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const reset = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return { start, reset };
}

function isStorageItem(item) {
    const s = `${item.sku || ''} ${item.unitType || ''} ${item.product || ''}`;
    return /storage|gigabyte|\bgb\b/i.test(s);
}

function isCodespacesItem(item) {
    return /codespace/i.test(`${item.product || ''} ${item.sku || ''}`);
}

/** cores encoded in a SKU like "Codespaces compute 4 core" / "codespaces_compute_4_core". */
function coresFromSku(sku) {
    const s = String(sku || '');
    // "Codespaces compute 2-core", "codespaces_compute_4_core", "8 core"
    let m = s.match(/(\d+)[\s_-]*cores?\b/i);
    if (m) return Number(m[1]);
    // "codespaces_compute_d2", "codespaces_compute_c4", "..._d16_v2"
    m = s.match(/(?:^|[_\s-])[dc](\d+)(?=$|[_\s-])/i);
    return m ? Number(m[1]) : null;
}

/** Quantity -> core-hours. Compute SKUs bill clock hours per machine size.
 *  Returns null when the SKU has no parseable core count (caller must not guess). */
function itemCoreHours(item, qty) {
    const cores = coresFromSku(item.sku);
    return cores ? qty * cores : null;
}

/**
 * Parse /settings/billing/usage/summary (or /usage) items into totals.
 * Remaining is NOT returned by GitHub; we compute it from discountQuantity.
 */
function parseSummary(json) {
    const items = (json && (json.usageItems || json.usage_items)) || [];
    const out = {
        computeCoreHours: 0, includedCoreHours: 0, computeNet: 0,
        storageGbMonths: 0, includedStorage: 0, storageNet: 0,
        grossAmount: 0, discountAmount: 0, netAmount: 0, gross: 0, computeAmount: 0, storageAmount: 0,
        bySku: [], unknownSkus: []
    };
    for (const it of items) {
        if (!isCodespacesItem(it)) continue;
        const gross = Number(it.grossQuantity ?? it.quantity ?? 0);
        const disc = Number(it.discountQuantity ?? 0);
        const net = Number(it.netAmount ?? 0);
        out.grossAmount += Number(it.grossAmount ?? 0);
        out.discountAmount += Number(it.discountAmount ?? 0);
        out.netAmount += net;
        if (isStorageItem(it)) {
            // GitHub labels storage "gigabyte-hours" but the quantity is already GB-months
            // (priced at $0.07/GB-month), so it is used as-is.
            out.storageGbMonths += gross;
            out.includedStorage += disc;
            out.storageNet += net;
            out.storageAmount += Number(it.grossAmount ?? 0);
        } else {
            if (itemCoreHours(it, gross) == null) {
                if (!out.unknownSkus.includes(String(it.sku))) out.unknownSkus.push(String(it.sku));
                continue;
            }
            out.computeCoreHours += itemCoreHours(it, gross);
            out.includedCoreHours += itemCoreHours(it, disc);
            out.computeNet += net;
            out.computeAmount += Number(it.grossAmount ?? 0);
            out.bySku.push({ sku: it.sku, cores: coresFromSku(it.sku), coreHours: itemCoreHours(it, gross), net });
        }
    }
    out.gross = out.grossAmount;
    return out;
}

/**
 * Daily usage lines -> charts + per-repository breakdown (all values straight from the API rows).
 * Returns:
 *  daily        {date: compute core-hrs}
 *  dailyAmount  {date: compute $ (grossAmount)}
 *  dailyStorage {date: storage GB-month}
 *  dailyStorageAmount {date: storage $}
 *  repos        [{repo, coreHours, storageGbMonths, amount, computeAmount, storageAmount, skus:[...], daily:{date: core-hrs}}]
 *  rows         normalised rows for CSV/JSON export
 */
function parseDaily(json, cycleStart, cycleEnd) {
    const items = (json && (json.usageItems || json.usage_items)) || [];
    const daily = {}, dailyAmount = {}, dailyStorage = {}, dailyStorageAmount = {}, byRepo = {}, repoMap = {};
    const rows = [];
    const startMs = cycleStart ? new Date(cycleStart).getTime() : -Infinity;
    const endMs = cycleEnd ? new Date(cycleEnd).getTime() : Infinity;
    for (const it of items) {
        if (!isCodespacesItem(it)) continue;
        const date = String(it.date || '').slice(0, 10);
        if (!date) continue;
        const dMs = new Date(date + 'T00:00:00Z').getTime();
        if (dMs < startMs || dMs >= endMs) continue;
        const repo = it.repositoryName || '(no repository)';
        const r = repoMap[repo] || (repoMap[repo] = { repo, coreHours: 0, storageGbMonths: 0, amount: 0, computeAmount: 0, storageAmount: 0, skuMap: {}, daily: {} });
        const gross = Number(it.grossAmount ?? 0);
        const qty = Number(it.quantity ?? it.grossQuantity ?? 0);
        r.amount += gross;
        const sku = String(it.sku || '');
        const k = r.skuMap[sku] || (r.skuMap[sku] = { sku, kind: '', cores: null, quantity: 0, unitType: it.unitType || '', coreHours: 0, gbMonths: 0, amount: 0 });
        k.quantity += qty; k.amount += gross;
        const row = { date, repository: repo, sku, unitType: it.unitType || '', quantity: qty, coreHours: null, gbMonths: null, grossAmount: gross, discountAmount: Number(it.discountAmount ?? 0), netAmount: Number(it.netAmount ?? 0) };
        if (isStorageItem(it)) {
            k.kind = 'storage'; k.gbMonths += qty;
            r.storageGbMonths += qty; r.storageAmount += gross;
            dailyStorage[date] = (dailyStorage[date] || 0) + qty;
            dailyStorageAmount[date] = (dailyStorageAmount[date] || 0) + gross;
            row.gbMonths = qty;
        } else {
            const ch = itemCoreHours(it, qty);
            k.kind = 'compute'; k.cores = coresFromSku(sku);
            if (ch == null) { rows.push(row); continue; }
            k.coreHours += ch;
            daily[date] = (daily[date] || 0) + ch;
            dailyAmount[date] = (dailyAmount[date] || 0) + gross;
            byRepo[repo] = (byRepo[repo] || 0) + ch;
            r.coreHours += ch; r.computeAmount += gross;
            r.daily[date] = (r.daily[date] || 0) + ch;
            row.coreHours = ch;
        }
        rows.push(row);
    }
    const repos = Object.values(repoMap).map(r => {
        const skus = Object.values(r.skuMap).sort((a, b) => b.amount - a.amount);
        delete r.skuMap;
        return { ...r, skus };
    }).sort((a, b) => b.amount - a.amount);
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.repository.localeCompare(b.repository)));
    return { daily, dailyAmount, dailyStorage, dailyStorageAmount, byRepo, repos, rows };
}

function dateKey(ms) { return new Date(ms).toISOString().slice(0, 10); }

/**
 * Core numbers + days-left rules (all derived by plain arithmetic):
 *  - remaining = max(0, quota - used)
 *  - avg/day   = core-hrs over the last min(7, days elapsed in cycle) days
 *  - < 3 days elapsed  -> 'not enough data'
 *  - remaining 0       -> 'quota used up'
 *  - lasts past reset  -> "won't run out before reset"
 */
function computeStats({ quota, used, daily = {}, now = new Date(), reset, cycleStart }) {
    const q = Math.max(0, Number(quota) || 0);
    const u = Math.max(0, Number(used) || 0);
    const remaining = Math.max(0, q - u);
    const pct = q > 0 ? Math.min(100, (u / q) * 100) : (u > 0 ? 100 : 0);
    const level = pct >= 90 ? 'red' : pct >= 75 ? 'amber' : 'ok';

    const nowMs = new Date(now).getTime();
    const todayMs = new Date(dateKey(nowMs) + 'T00:00:00Z').getTime();
    const dates = Object.keys(daily).filter(d => new Date(d + 'T00:00:00Z').getTime() <= nowMs).sort();
    // Days elapsed in the cycle (inclusive of today). Falls back to the first data day when no cycle start is given.
    const startMs = cycleStart ? new Date(cycleStart).getTime() : (dates.length ? new Date(dates[0] + 'T00:00:00Z').getTime() : todayMs);
    const dataDays = Math.max(0, Math.floor((todayMs - startMs) / DAY_MS) + 1);
    const windowDays = Math.min(7, dataDays);
    let last7 = 0;
    for (const d of dates) {
        const age = Math.floor((todayMs - new Date(d + 'T00:00:00Z').getTime()) / DAY_MS);
        if (age >= 0 && age < windowDays) last7 += Number(daily[d]) || 0;
    }
    const avgPerDay = windowDays > 0 ? last7 / windowDays : 0;

    let daysLeft = null, daysLeftLabel;
    const daysToReset = reset ? Math.max(0, (new Date(reset).getTime() - nowMs) / DAY_MS) : Infinity;
    if (q > 0 && remaining <= 0) daysLeftLabel = 'quota used up';
    else if (dataDays < 3) daysLeftLabel = 'not enough data';
    else if (avgPerDay <= 0) daysLeftLabel = "won't run out before reset";
    else {
        daysLeft = remaining / avgPerDay;
        daysLeftLabel = daysLeft >= daysToReset ? "won't run out before reset" : `about ${Math.max(0, Math.floor(daysLeft))} days left`;
    }
    return { quota: q, used: round(u), remaining: round(remaining), pct: round(pct), level, avgPerDay: round(avgPerDay), avgWindowDays: windowDays, daysLeft, daysLeftLabel, dataDays };
}

const MACHINE_SIZES = [2, 4, 8, 16, 32];

/**
 * Derived analytics (plain arithmetic on billing data; every value is labelled "derived" in the UI).
 *  - projection: used + avg/day x days remaining in the cycle
 *  - runOutDate: now + remaining / avg/day (only if before reset)
 *  - remaining clock hours per machine size: remaining core-hrs / cores
 *  - peak day, active days, today, cumulative series vs ideal pace
 */
function buildAnalytics({ stats, quota, daily = {}, dailyAmount = {}, cycleStart, reset, now, isCurrent = true }) {
    const startMs = new Date(cycleStart).getTime();
    const resetMs = new Date(reset).getTime();
    const nowMs = isCurrent ? Math.min(new Date(now).getTime(), resetMs - 1) : resetMs - 1;
    const totalDays = Math.max(1, Math.round((resetMs - startMs) / DAY_MS));
    const elapsedDays = Math.min(totalDays, Math.max(1, Math.floor((nowMs - startMs) / DAY_MS) + 1));
    const used = stats.used, remaining = stats.remaining, avg = stats.avgPerDay;
    const daysRemaining = Math.max(0, (resetMs - nowMs) / DAY_MS);

    let projectedEnd = used, runOutDate = null, projectionLabel;
    if (!isCurrent) {
        projectionLabel = 'Closed month';
    } else if (quota > 0 && remaining <= 0) {
        projectionLabel = 'Quota used up — further usage is billed';
    } else if (stats.dataDays < 3) {
        projectionLabel = 'Not enough data yet (needs 3 days)';
    } else {
        projectedEnd = used + avg * daysRemaining;
        if (avg > 0 && quota > 0 && projectedEnd > quota) {
            runOutDate = new Date(nowMs + (remaining / avg) * DAY_MS).toISOString();
            projectionLabel = 'runs out';
        } else {
            projectionLabel = "won't run out before reset";
        }
    }

    let peak = null, activeDays = 0;
    const series = [];
    let cum = 0;
    for (let i = 0; i < totalDays; i++) {
        const key = dateKey(startMs + i * DAY_MS);
        const v = Number(daily[key]) || 0;
        if (v > 0) activeDays++;
        if (v > 0 && (!peak || v > peak.value)) peak = { date: key, value: v, amount: Number(dailyAmount[key]) || 0 };
        const future = startMs + i * DAY_MS > nowMs;
        cum += v;
        series.push({ date: key, value: v, amount: Number(dailyAmount[key]) || 0, cumulative: future ? null : cum, pace: quota > 0 ? (quota * (i + 1)) / totalDays : 0, future });
    }
    const todayKey = dateKey(nowMs);
    return {
        totalDays, elapsedDays, daysRemaining: round(daysRemaining, 1),
        avgCycle: round(used / elapsedDays, 2),
        projectedEnd: round(projectedEnd), runOutDate, projectionLabel,
        remainingByMachine: MACHINE_SIZES.map(c => ({ cores: c, hours: round(remaining / c, 1), pricePerHour: pricePerHour(c) })),
        peak: peak ? { ...peak, value: round(peak.value, 2), amount: round(peak.amount, 2) } : null,
        activeDays,
        today: isCurrent ? { date: todayKey, value: round(Number(daily[todayKey]) || 0, 2), amount: round(Number(dailyAmount[todayKey]) || 0, 2) } : null,
        series
    };
}

/** Month-over-month comparison of two parsed summaries. */
function compareMonths(cur, prev) {
    if (!cur || !prev) return null;
    const d = (a, b) => ({ current: round(a, 2), previous: round(b, 2), delta: round(a - b, 2), pct: b > 0 ? round(((a - b) / b) * 100) : null });
    return {
        coreHours: d(cur.computeCoreHours, prev.computeCoreHours),
        storageGbMonths: d(cur.storageGbMonths, prev.storageGbMonths),
        consumed: d(cur.grossAmount, prev.grossAmount),
        billable: d(cur.netAmount, prev.netAmount)
    };
}

/** Billing periods for the month switcher: the current month and the N-1 before it. */
function monthOptions(now = new Date(), count = 6) {
    const d = new Date(now);
    const out = [];
    for (let i = 0; i < count; i++) {
        const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
        out.push({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, current: i === 0,
            label: dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) });
    }
    return out;
}

/**
 * Threshold alerts not yet shown. Only for the current month's live data.
 * @param {object} u usage result
 * @param {number[]} thresholds percentages, e.g. [75, 90]
 * @param {object} shown map of already-shown alert keys
 */
function pendingAlerts(u, thresholds, shown = {}) {
    if (!u || u.mode !== 'live' || u.isCurrent === false || u.offline) return [];
    const list = (Array.isArray(thresholds) ? thresholds : []).map(Number).filter(t => t > 0 && t <= 100).sort((a, b) => a - b);
    const out = [];
    const ym = u.period ? `${u.period.year}-${u.period.month}` : '';
    const check = (kind, used, quota, unit) => {
        if (!(quota > 0)) return;
        const pct = (used / quota) * 100;
        for (const t of list) {
            const key = `${u.login}|${ym}|${kind}|${t}`;
            if (pct >= t && !shown[key]) out.push({ key, kind, threshold: t, message: `Codespaces ${kind} for ${u.login}: ${Math.round(pct)}% of the included quota used (${Math.round(used * 10) / 10} / ${quota} ${unit}).` });
        }
    };
    if (u.compute) check('compute', u.compute.used, u.compute.quota, 'core-hrs');
    if (u.storage && u.storage.used != null) check('storage', u.storage.used, u.storage.quota, 'GB-month');
    return out;
}

function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** CSV of the raw daily rows (one line per API row, plus derived core-hours / GB-month). */
function toCsv(u) {
    const head = ['date', 'repository', 'sku', 'unit_type', 'quantity', 'core_hours', 'gb_months', 'gross_amount_usd', 'discount_amount_usd', 'net_amount_usd'];
    const lines = [head.join(',')];
    for (const r of (u && u.rows) || []) {
        lines.push([r.date, r.repository, r.sku, r.unitType, r.quantity, r.coreHours == null ? '' : round(r.coreHours, 4), r.gbMonths == null ? '' : round(r.gbMonths, 4), round(r.grossAmount, 4), round(r.discountAmount, 4), round(r.netAmount, 4)].map(csvCell).join(','));
    }
    return lines.join('\r\n') + '\r\n';
}

/** JSON export: totals from the summary API + the daily rows. No tokens or headers. */
function toJson(u) {
    return JSON.stringify({
        account: u.login, plan: u.plan && u.plan.label, period: u.period,
        source: 'GitHub billing API (/settings/billing/usage/summary and /settings/billing/usage)',
        exportedAt: new Date(u.fetchedAt || Date.now()).toISOString(),
        compute: u.compute, storage: u.storage, dollars: u.dollars,
        derived: u.analytics ? { remainingCoreHours: u.stats.remaining, avgPerDayLast7: u.stats.avgPerDay, projectedEndCoreHours: u.analytics.projectedEnd, runOutDate: u.analytics.runOutDate, remainingByMachine: u.analytics.remainingByMachine } : null,
        repositories: (u.repos || []).map(r => ({ repository: r.repo, coreHours: r.coreHours, storageGbMonths: r.storageGbMonths, amount: r.amount, skus: r.skus })),
        rows: u.rows || []
    }, null, 2);
}

/** Is a codespace billed to someone else (an org)? */
function isOrgBilled(cs, login) {
    const owner = cs && cs.billable_owner && cs.billable_owner.login;
    return !!owner && !!login && owner.toLowerCase() !== String(login).toLowerCase();
}

// ── Service ────────────────────────────────────────────────────────────────

class UsageService {
    /**
     * @param {object} opts
     * @param {{getToken:(acc:string)=>Promise<string|null>}} opts.authManager
     * @param {Function} [opts.fetchImpl]   defaults to global fetch
     * @param {() => object} [opts.getConfig] returns { plan, monthlyCoreHours, monthlyStorageGb }
     * @param {() => number} [opts.now]
     */
    constructor({ authManager, fetchImpl, getConfig, now, log, getActiveAccount } = {}) {
        this._getActive = typeof getActiveAccount === 'function' ? getActiveAccount : async () => (authManager && authManager.getActiveAccount ? authManager.getActiveAccount() : null);
        this._log = typeof log === 'function' ? log : () => {};
        this._auth = authManager;
        this._fetch = fetchImpl || ((...a) => fetch(...a));
        this._getConfig = getConfig || (() => ({}));
        this._now = now || (() => Date.now());
        this._cache = new Map();
        this._listeners = new Set();
        this._onLoaded = null;
    }

    /** Called with every freshly loaded result (used for threshold alerts). */
    onLoaded(fn) { this._onLoaded = fn; }

    onDidChange(fn) { this._listeners.add(fn); return { dispose: () => this._listeners.delete(fn) }; }
    _emit() { for (const fn of this._listeners) { try { fn(); } catch {} } }

    clearCache() { this._cache.clear(); }
    /** Mark cached results stale; they are only replaced after a successful refetch. */
    async refresh() { for (const e of this._cache.values()) e.at = -Infinity; this._emit(); }

    async _get(url, token) {
        const res = await this._fetch(url, { headers: { ...API_HEADERS, 'Authorization': `Bearer ${token}` } });
        let body = null;
        try { body = await res.json(); } catch {}
        const scopes = res.headers && typeof res.headers.get === 'function' ? (res.headers.get('x-oauth-scopes') || '') : '';
        return { status: res.status, ok: res.ok, body, scopes };
    }

    /** UI options from settings (preferred unit, sidebar visibility). */
    viewOptions() {
        const c = this._getConfig() || {};
        return { preferredUnit: c.preferredUnit === 'dollars' ? 'dollars' : 'core-hours', show: c.showSidebarLine !== false };
    }

    _ttl() {
        const m = Number(this._getConfig().refreshMinutes);
        return Number.isFinite(m) && m >= 5 ? m * 60 * 1000 : CACHE_TTL_MS;
    }

    /** @param {{year:number, month:number}} [period] defaults to the current month */
    async getActiveUsage(period) {
        const account = await this._getActive();
        if (!account) return null;
        try { return await this.getAccountUsage(account, period); }
        catch (err) { return { account, login: account, mode: 'error', error: String(err && err.message || err) }; }
    }

    async getAllUsage(accounts) {
        const list = (accounts || []).map(a => (typeof a === 'string' ? a : a.account)).filter(Boolean);
        return Promise.all(list.map(acc => this.getAccountUsage(acc).catch(err => ({ account: acc, mode: 'error', error: String(err && err.message || err) }))));
    }

    async getAccountUsage(account, period) {
        const nowMs = this._now();
        const cur = new Date(nowMs);
        const p = period && period.year && period.month ? { year: Number(period.year), month: Number(period.month) } : { year: cur.getUTCFullYear(), month: cur.getUTCMonth() + 1 };
        const key = `${account}|${p.year}-${p.month}`;
        const hit = this._cache.get(key);
        if (hit && nowMs - hit.at < this._ttl()) return hit.data;
        let data;
        try {
            data = await this._load(account, nowMs, p);
        } catch (err) {
            // Network failure: keep the last good result instead of blanking the card.
            if (hit && hit.data) return { ...hit.data, offline: true, lastUpdated: hit.data.fetchedAt };
            throw err;
        }
        this._cache.set(key, { at: nowMs, data });
        if (this._onLoaded) { try { this._onLoaded(data); } catch {} }
        return data;
    }

    async _load(account, nowMs, period) {
        const curCycle = billingCycle(new Date(nowMs));
        const start = new Date(Date.UTC(period.year, period.month - 1, 1));
        const reset = new Date(Date.UTC(period.year, period.month, 1));
        const isCurrent = start.getTime() === curCycle.start.getTime();
        if (start.getTime() > curCycle.start.getTime()) throw new Error('Future billing periods have no data.');
        // For closed months, stats are computed as of the last moment of that month.
        const now = new Date(isCurrent ? nowMs : reset.getTime() - 1);
        const prevStart = new Date(Date.UTC(period.year, period.month - 2, 1));
        const base = { account, login: account, fetchedAt: nowMs, cycleStart: start.toISOString(), resetDate: reset.toISOString(), isCurrent,
            period: { year: period.year, month: period.month }, months: monthOptions(new Date(nowMs)) };

        const token = await this._auth.getToken(account);
        if (!token) return { ...base, mode: 'needsPermission', reason: 'No token for this account' };

        const user = await this._get(`${GITHUB_API_BASE}/user`, token);
        const login = (user.body && user.body.login) || account;
        const hasUserScope = /(^|[\s,])user($|[\s,])/.test(user.scopes) || !!(user.body && user.body.plan);
        const plan = resolvePlan(user.body && user.body.plan && user.body.plan.name, this._getConfig());
        base.login = login; base.plan = plan;

        // Codespaces list (no `user` scope needed)
        let codespaces = [];
        try {
            const cs = await this._get(`${GITHUB_API_BASE}/user/codespaces?per_page=100`, token);
            if (cs.ok && cs.body) codespaces = cs.body.codespaces || [];
        } catch {}
        const orgBilled = [...new Set(codespaces.filter(c => isOrgBilled(c, login)).map(c => c.billable_owner.login))];
        const personalCs = codespaces.filter(c => !isOrgBilled(c, login));
        base.orgBilled = orgBilled;
        base.codespaceCount = personalCs.length;

        if (!plan.personal && personalCs.length === 0) {
            return { ...base, mode: 'orgBilled' };
        }

        const u = encodeURIComponent(login);
        // Network errors propagate (offline handling in getAccountUsage).
        const q = (y, m) => `year=${y}&month=${m}`;
        const summary = await this._get(`${GITHUB_API_BASE}/users/${u}/settings/billing/usage/summary?product=codespaces&${q(period.year, period.month)}`, token);

        let parsed = summary.ok ? parseSummary(summary.body) : null;
        if (parsed && parsed.unknownSkus.length) {
            this._log(`Usage: unrecognised Codespaces compute SKU(s) for ${login}: ${parsed.unknownSkus.join(', ')}; showing an error instead of guessed numbers.`);
            parsed = null;
        }
        if (parsed) {
            const s = parsed;
            let dd = { daily: {}, dailyAmount: {}, dailyStorage: {}, dailyStorageAmount: {}, repos: [], rows: [] }, dailyError = null;
            const [dRes, prevRes] = await Promise.all([
                this._get(`${GITHUB_API_BASE}/users/${u}/settings/billing/usage?${q(period.year, period.month)}`, token).catch(() => null),
                this._get(`${GITHUB_API_BASE}/users/${u}/settings/billing/usage/summary?product=codespaces&${q(prevStart.getUTCFullYear(), prevStart.getUTCMonth() + 1)}`, token).catch(() => null)
            ]);
            if (!dRes) dailyError = 'Daily usage API unreachable';
            else if (dRes.ok) dd = parseDaily(dRes.body, start, reset);
            else dailyError = `Daily usage API returned ${dRes.status}`;
            let prev = null;
            if (prevRes && prevRes.ok) {
                const ps = parseSummary(prevRes.body);
                if (!ps.unknownSkus.length) prev = ps;
            }
            // remaining = quota - included usage (discountQuantity); usage beyond the quota is billed
            const used = Math.max(s.includedCoreHours, s.computeCoreHours);
            const stats = computeStats({ quota: plan.coreHours, used, daily: dd.daily, now, reset, cycleStart: start });
            stats.includedUsed = round(s.includedCoreHours);
            const analytics = buildAnalytics({ stats, quota: plan.coreHours, daily: dd.daily, dailyAmount: dd.dailyAmount, cycleStart: start, reset, now, isCurrent });
            const storageAnalytics = buildAnalytics({ stats: computeStats({ quota: 0, used: s.storageGbMonths, daily: dd.dailyStorage, now, reset, cycleStart: start }), quota: 0, daily: dd.dailyStorage, dailyAmount: dd.dailyStorageAmount, cycleStart: start, reset, now, isCurrent });
            const totalAmount = dd.repos.reduce((t, r) => t + r.amount, 0);
            const dailyCompute = Object.values(dd.daily).reduce((t, v) => t + v, 0);
            return {
                ...base, mode: 'live', stats, analytics, storageSeries: storageAnalytics.series,
                daily: dd.daily, dailyAmount: dd.dailyAmount, dailyStorage: dd.dailyStorage, dailyError,
                // Daily rows can trail the summary by a few hours; report the gap instead of hiding it.
                dailyGapCoreHours: round(used - dailyCompute, 2),
                compute: { used: round(used), quota: plan.coreHours, amount: round(s.computeAmount, 2), quotaValue: round(plan.coreHours * CORE_HOUR_PRICE, 2) },
                storage: { used: round(s.storageGbMonths, 2), quota: plan.storageGb, amount: round(s.storageAmount, 2), quotaValue: round(plan.storageGb * STORAGE_PRICE_PER_GB_MONTH, 2) },
                dollars: { consumed: round(s.grossAmount, 2), discount: round(s.discountAmount, 2), billable: round(s.netAmount, 2) },
                billed: round(s.netAmount, 2),
                skus: s.bySku.map(k => ({ sku: k.sku, cores: k.cores, coreHours: round(k.coreHours, 2), net: round(k.net, 2) })),
                mom: compareMonths(s, prev),
                prevPeriod: { year: prevStart.getUTCFullYear(), month: prevStart.getUTCMonth() + 1 },
                repos: dd.repos.map(r => ({
                    repo: r.repo, coreHours: round(r.coreHours), storageGbMonths: round(r.storageGbMonths, 2),
                    amount: round(r.amount, 2), computeAmount: round(r.computeAmount, 2), storageAmount: round(r.storageAmount, 2),
                    share: totalAmount > 0 ? round((r.amount / totalAmount) * 100) : 0,
                    skus: r.skus.map(k => ({ ...k, quantity: round(k.quantity, 3), coreHours: round(k.coreHours, 2), gbMonths: round(k.gbMonths, 3), amount: round(k.amount, 2) })),
                    daily: r.daily
                })),
                storageRows: dd.repos.filter(r => r.storageGbMonths > 0).sort((a, b) => b.storageGbMonths - a.storageGbMonths).map(r => ({ name: r.repo, repo: r.repo, storageGbMonths: round(r.storageGbMonths, 2), amount: round(r.storageAmount, 2) })),
                rows: dd.rows
            };
        }

        const status = summary.ok ? 'unknown-sku' : summary.status;
        if ((status === 403 || status === 404 || status === 401) && !hasUserScope) {
            return { ...base, mode: 'needsPermission', status, reason: 'The billing API needs the "user" scope.' };
        }

        // No guessed figures: every other failure is a clear error state with the reason.
        const fix = 'gh auth refresh -h github.com -s user';
        let error;
        if (status === 'unknown-sku') error = `GitHub returned a Codespaces SKU this version can't read (${(summary.ok && parseSummary(summary.body).unknownSkus.join(', ')) || 'unknown'}). Update the extension.`;
        else if (status === 404 || status === 403) error = `GitHub billing API returned ${status}. This account may not be on GitHub's enhanced billing platform, or the token lacks the "user" scope.`;
        else error = `GitHub billing API returned ${status}${summary.body && summary.body.message ? ': ' + summary.body.message : ''}.`;
        return { ...base, mode: 'error', status, error, fix };
    }
}

module.exports = {
    UsageService, PLAN_QUOTAS, PRICE_PER_HOUR, STORAGE_PRICE_PER_GB_MONTH, CORE_HOUR_PRICE, CACHE_TTL_MS,
    coreHoursFor, pricePerHour, resolvePlan, billingCycle, parseSummary, parseDaily, computeStats,
    isOrgBilled, coresFromSku, buildAnalytics, compareMonths, monthOptions, toCsv, toJson, MACHINE_SIZES, pendingAlerts
};
