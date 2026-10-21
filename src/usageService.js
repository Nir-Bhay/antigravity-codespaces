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
 * Daily usage lines -> chart + per-repository breakdown.
 * { daily: {YYYY-MM-DD: coreHours}, byRepo: {repo: coreHours}, repos: [{repo, coreHours, storageGbMonths, amount}] }
 */
function parseDaily(json, cycleStart) {
    const items = (json && (json.usageItems || json.usage_items)) || [];
    const daily = {}, byRepo = {}, repoMap = {};
    const startMs = cycleStart ? new Date(cycleStart).getTime() : 0;
    for (const it of items) {
        if (!isCodespacesItem(it)) continue;
        const date = String(it.date || '').slice(0, 10);
        if (!date || new Date(date + 'T00:00:00Z').getTime() < startMs) continue;
        const repo = it.repositoryName || '(unknown)';
        const r = repoMap[repo] || (repoMap[repo] = { repo, coreHours: 0, storageGbMonths: 0, amount: 0 });
        r.amount += Number(it.grossAmount ?? 0);
        const qty = Number(it.quantity ?? it.grossQuantity ?? 0);
        if (isStorageItem(it)) { r.storageGbMonths += qty; continue; }
        const ch = itemCoreHours(it, qty);
        if (ch == null) continue;
        daily[date] = (daily[date] || 0) + ch;
        byRepo[repo] = (byRepo[repo] || 0) + ch;
        r.coreHours += ch;
    }
    const repos = Object.values(repoMap).sort((a, b) => b.amount - a.amount);
    return { daily, byRepo, repos };
}

/**
 * Core numbers + days-left rules.
 *  - remaining = max(0, quota - used)
 *  - avg/day = last 7 days (only days within the cycle)
 *  - < 3 days of data -> 'not enough data'
 *  - remaining 0      -> 'quota used up'
 *  - lasts past reset -> 'lasts the full cycle'
 */
function computeStats({ quota, used, daily = {}, now = new Date(), reset }) {
    const q = Math.max(0, Number(quota) || 0);
    const u = Math.max(0, Number(used) || 0);
    const remaining = Math.max(0, q - u);
    const pct = q > 0 ? Math.min(100, (u / q) * 100) : (u > 0 ? 100 : 0);
    const level = pct >= 90 ? 'red' : pct >= 75 ? 'amber' : 'ok';

    const nowMs = new Date(now).getTime();
    const dates = Object.keys(daily).filter(d => new Date(d + 'T00:00:00Z').getTime() <= nowMs).sort();
    const dataDays = dates.length ? Math.floor((nowMs - new Date(dates[0] + 'T00:00:00Z').getTime()) / DAY_MS) + 1 : 0;
    const windowDays = Math.min(7, Math.max(dataDays, 0));
    let last7 = 0;
    for (const d of dates) {
        const age = Math.floor((nowMs - new Date(d + 'T00:00:00Z').getTime()) / DAY_MS);
        if (age < 7) last7 += Number(daily[d]) || 0;
    }
    const avgPerDay = windowDays > 0 ? last7 / windowDays : 0;

    let daysLeft = null, daysLeftLabel;
    const daysToReset = reset ? Math.max(0, (new Date(reset).getTime() - nowMs) / DAY_MS) : Infinity;
    if (q > 0 && remaining <= 0) daysLeftLabel = 'quota used up';
    else if (dataDays < 3) daysLeftLabel = 'not enough data';
    else if (avgPerDay <= 0) daysLeftLabel = 'lasts the full cycle';
    else {
        daysLeft = remaining / avgPerDay;
        daysLeftLabel = daysLeft >= daysToReset ? 'lasts the full cycle' : `about ${Math.max(0, Math.floor(daysLeft))} days left`;
    }
    return { quota: q, used: round(u), remaining: round(remaining), pct: round(pct), level, avgPerDay: round(avgPerDay), daysLeft, daysLeftLabel, dataDays };
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
    }

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

    async getActiveUsage() {
        const account = await this._getActive();
        if (!account) return null;
        try { return await this.getAccountUsage(account); }
        catch (err) { return { account, login: account, mode: 'error', error: String(err && err.message || err) }; }
    }

    async getAllUsage(accounts) {
        const list = (accounts || []).map(a => (typeof a === 'string' ? a : a.account)).filter(Boolean);
        return Promise.all(list.map(acc => this.getAccountUsage(acc).catch(err => ({ account: acc, mode: 'error', error: String(err && err.message || err) }))));
    }

    async getAccountUsage(account) {
        const hit = this._cache.get(account);
        const nowMs = this._now();
        if (hit && nowMs - hit.at < CACHE_TTL_MS) return hit.data;
        let data;
        try {
            data = await this._load(account, nowMs);
        } catch (err) {
            // Network failure: keep the last good result instead of blanking the card.
            if (hit && hit.data) return { ...hit.data, offline: true, lastUpdated: hit.data.fetchedAt };
            throw err;
        }
        this._cache.set(account, { at: nowMs, data });
        return data;
    }

    async _load(account, nowMs) {
        const now = new Date(nowMs);
        const { start, reset } = billingCycle(now);
        const base = { account, login: account, fetchedAt: nowMs, cycleStart: start.toISOString(), resetDate: reset.toISOString() };

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
        const summary = await this._get(`${GITHUB_API_BASE}/users/${u}/settings/billing/usage/summary?product=codespaces&year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`, token);

        let parsed = summary.ok ? parseSummary(summary.body) : null;
        if (parsed && parsed.unknownSkus.length) {
            this._log(`Usage: unrecognised Codespaces compute SKU(s) for ${login}: ${parsed.unknownSkus.join(', ')}; showing an error instead of guessed numbers.`);
            parsed = null;
        }
        if (parsed) {
            const s = parsed;
            let daily = {}, repos = [], dailyError = null;
            try {
                const d = await this._get(`${GITHUB_API_BASE}/users/${u}/settings/billing/usage?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`, token);
                if (d.ok) ({ daily, repos } = parseDaily(d.body, start));
                else dailyError = `Daily usage API returned ${d.status}`;
            } catch (e) { dailyError = 'Daily usage API unreachable'; }
            // remaining = quota - included usage (discountQuantity); usage beyond the quota is billed
            const used = Math.max(s.includedCoreHours, s.computeCoreHours);
            const stats = computeStats({ quota: plan.coreHours, used, daily, now, reset });
            stats.includedUsed = round(s.includedCoreHours);
            const totalAmount = repos.reduce((t, r) => t + r.amount, 0);
            return {
                ...base, mode: 'live', stats, daily, dailyError,
                // Separate quotas (not interchangeable): compute value = core-hrs x $0.09, storage = GB-month x $0.07
                compute: { used: round(used), quota: plan.coreHours, amount: round(s.computeAmount, 2), quotaValue: round(plan.coreHours * CORE_HOUR_PRICE, 2) },
                storage: { used: round(s.storageGbMonths, 2), quota: plan.storageGb, amount: round(s.storageAmount, 2), quotaValue: round(plan.storageGb * STORAGE_PRICE_PER_GB_MONTH, 2) },
                dollars: { consumed: round(s.grossAmount, 2), discount: round(s.discountAmount, 2), billable: round(s.netAmount, 2) },
                billed: round(s.netAmount, 2),
                repos: repos.map(r => ({ repo: r.repo, coreHours: round(r.coreHours), storageGbMonths: round(r.storageGbMonths, 2), amount: round(r.amount, 2), share: totalAmount > 0 ? round((r.amount / totalAmount) * 100) : 0 })),
                storageRows: repos.filter(r => r.storageGbMonths > 0).map(r => ({ name: r.repo, repo: r.repo, storageGbMonths: round(r.storageGbMonths, 2) }))
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
    isOrgBilled, coresFromSku
};
