# Antigravity Codespaces Pro — Re-Verified Findings, 2nd Edition (2026-09-04)

Read-only review. No source code changed. Every finding below was re-checked against the
current working tree with exact file:line references and runnable proof (POC script:
`C:\Users\lenovo\AppData\Local\Temp\opencode\poc-review.js`, run with `node`).

IMPORTANT TREE NOTE: the working tree is under active edit. Between the two review passes
`src/dashboardProvider.js` changed (2710 → 2726 lines; error page rewritten from inline
`onclick` to `addEventListener`). Line numbers below are from the current tree. Also
`git diff --stat` shows ~4041 insertions / ~1003 deletions uncommitted vs HEAD — the
committed tree and the `.vsix` files on disk describe older code. Commit before release.

## 0. Safety verdict first (your crash question)

Nothing found can crash the OS, the machine, or VS Code itself ("RX system crash" risk: none).
Reasons: the extension runs inside the VS Code extension host sandbox — no kernel/driver
access, no privileged syscalls. Worst-case blast radius per finding class:

- SSH findings (C1/C2): worst case is extra/corrupt lines inside the user's own
  `~/.ssh/config` scoped around the extension's `# CS_ENTRY:` blocks (SSH would fail to
  parse that host entry or refuse that connection). No system-wide effect; fixable by
  deleting those blocks. Practical exploitability is LOW (see C1).
- Process findings (H1): worst case is transient `gh` child processes that outlive the
  timeout and exit on their own. No fork bomb (one spawn per user action), no crash.
- All dashboard/cache/auth findings: worst case is stale/wrong UI, confusing error text,
  or an extra login prompt. No data loss except the single intended destructive action
  (Codespace delete, which is server-side and explicitly confirmed in the webview modal).

## 1. Corrections to the 1st edition (3 false alarms removed, several severities fixed)

| # | 1st-edition claim | Re-verification result |
|---|-------------------|------------------------|
| F1 | "CI bug: Node has no `-c` flag" | FALSE ALARM. `node -c extension.js` exits 0; `node --help` lists `-c, --check`. Both workflows (`build-and-release.yml:27`, `open-vsx-publish.yml:26`) are valid. Removed. |
| F2 | "`*.vsix` tracked despite `.gitignore` (~577 KB bloat)" | FALSE ALARM. `git ls-files` shows ZERO vsix entries; `git status --short` does not list them → they are untracked + properly ignored. No bloat. Removed. (Both `.vsix` files on disk were built from an older tree — rebuild after commit still applies.) |
| F3 | "`window.prompt()` in dashboard wizard breaks sandbox" | FALSE ALARM for current code. `grep window.prompt src/*.js` → no matches. The claim exists only historically in `docs/AUDIT_REPORT.md:90-99`. Treat as already-resolved; removed from current findings. |
| S1 | D4 "Retry button dead (inline onclick)" | Mechanism CORRECTED. Current error page (`dashboardProvider.js:194,196-199`) uses `id="btnErrRetry"` + nonce `addEventListener` (good), BUT the CSP meta (`:181`) is `default-src 'none'; style-src …` with NO `script-src`. Per CSP spec, `script-src` falls back to `default-src`, and `'none'` blocks ALL scripts including nonced ones → the listener never attaches → Retry still dead. Severity lowered High → Medium (page only renders when `getAccounts()` itself throws, which is rare — inner sources are individually try/caught). Fix: add `script-src 'nonce-…'` to that meta tag. |
| S2 | C3 cache collision "Critical" | DOWNGRADED to Medium. Key `account \|\| 'default'` (`githubApi.js:29`, repeated at 119,132,155,166,189,200,222,360,373) only collides when callers pass a falsy account. Verified all hot-path callers pass explicit accounts (dashboard `:165-168` iterates `acc.account`; sidebar `:133-135` falls back to `accounts[0].account`; statusbar/quickConnect/sync/startup likewise). Residual real gap: falsy-account edge + no invalidation discipline (meta/ports key `${account\|\|''}:${name}`; harmless in practice since codespace names are globally unique). Keep the fix (resolve account before keying), drop the alarm. |
| S3 | D3 "per-account error collected but dropped" | Mechanism CORRECTED. `refreshHtml` (`:164-172`) does collect `error`, and `buildDashboardHtml` (`:206`) does drop it — but the `catch` at `:169` is nearly DEAD code because `listCodespaces` catches everything internally and returns `[]` (`githubApi.js:90-93`). The REAL gap: partial failures are invisible (empty list, no banner), not "dropped error field". Same fix (surface per-account errors), accurate cause. |
| S4 | H7 "REST/CLI shape mismatch breaks consumers" | WEAKENED. `fetchMeta` REST path normalizes; CLI path requests matching field names, so shapes are close. One CONFIRMED difference: the CLI path never attaches `account` (REST path does, `githubApi.js:272`), so sidebar `meta.account \|\| ''` (`sidebarProvider.js:1611+`) is empty for CLI-path metas → downstream `getToken(undefined)` falls back to active account (wrong token in multi-account edge). Fix = attach `account` + add TTLs. Severity High → Medium. |
| S5 | H11 "`existsSync(ANTIGRAVITY_EXE)` null-crash" | DOWNGRADED to Low/info. `findAntigravityExecutable()` always returns a string (every branch has a string fallback), so `undefined` is unreachable in practice; worst case the Tier-3 launcher is skipped and Tier-4 terminal fallback runs. Defensive guard still nice, not a bug. |
| S6 | PAT prefix allowlist "too narrow" | DOWNGRADED to Low. For user-entered PAT login the accepted `ghp_`/`github_pat_` cover the real cases (`gho_` is an OAuth token, `ghu_/ghs_/ghr_` are not user PATs). Keep-or-drop is cosmetic. |
| S7 | D9 "delete bypasses host modal" | QUALIFIED. Dashboard (`dashboardProvider.js:70-74`) always sends `confirmed:true`, skipping the host modal (`extension.js:517`) — but the dashboard HAS its own webview delete modal (`:2198,2517`) and the sidebar likewise confirms webview-side (`sidebarProvider.js:1518` sends `confirmed:true` only after its flow; sidebar host handler `:60-66` correctly respects `msg.confirmed === true`). So this is single-confirmation-by-design, not missing confirmation. Residual = trust-boundary note (compromised webview = unconfirmed server-side delete), severity Medium → Low/Medium. No data-loss bug in normal use. |

## 2. CONFIRMED findings (with POC / exact evidence)

### 2.1 SSH (real, low practical exploitability — fix as defense-in-depth)

- **C1 — SSH config injection via `cs.name` — CONFIRMED (string-level POC).**
  `src/sshManager.js:143,151,163,165`: `Host cs.${cs.name}`, `ProxyCommand "…" cs ssh -c "${cs.name}"`,
  `Host … ${rawName}` interpolate raw API data while `safeAccount`/`repoShort` are sanitized.
  POC output (no file written, pure string building):
  `cs.name = 'x"\nHost evil\n  HostName attacker.example\n  ProxyCommand evil.exe #'`
  produces injected `Host evil / HostName / ProxyCommand` lines in the generated block.
  Qualification: GitHub-generated codespace names use a safe charset, so an attacker would need
  to control API data (compromised token/response). NOT a crash risk; worst case = corrupt
  entry in the user's own ssh config, repaired by deleting `# CS_ENTRY:` blocks.
  Fix: allowlist `^[A-Za-z0-9-_]+$`, reject newline/quote.
- **C2 — unescaped `cs.name` in strip regex — CONFIRMED.**
  `:151,176`: `new RegExp('\\n*'+blockId+'[\\s\\S]*?TCPKeepAlive yes…')` with raw name; non-greedy
  match to the first `TCPKeepAlive yes` can span or miss. POC: regex builds (no throw for `"`),
  but names containing regex metacharacters/newlines break matching (newline demonstrably breaks
  block structure per C1 POC). Fix: `escapeRegExp` + explicit end-marker.

### 2.2 Command runner + API (real reliability bugs, no crash risk)

- **C4/H1 — `runCommand` merges stderr→stdout; timeout never kills child; shell fallback — CONFIRMED by read.**
  `src/utils.js:71-96`: `setTimeout` rejects without `child.kill()` (transient zombie `gh`, exits
  on its own — no crash); `execFile` error unconditionally re-runs via shell `exec` with
  `"${a.replace(/"/)}"` quoting, unsafe on POSIX (`$(…)` executes inside double quotes).
  `resolve((stdout+stderr).trim())` (`:83,93`) poisons every `JSON.parse` caller
  (`githubApi.js:86,237,287,320`) → silent `[]`/`{}` on any CLI warning. One rewrite
  (execFile-only, `AbortSignal.timeout`, stdout-only, kill-on-timeout) fixes JSON + token
  capture + zombies together.
- **H2 — `getAccounts()` live-verifies every PAT on every call — CONFIRMED** (`authManager.js:73-86`).
  Slow startup, rate-limit burn, accounts vanish offline → feeds H4 flap. Fix: trust index, lazy verify + TTL.
- **H3 — `gh auth status` shell-parse fragility — CONFIRMED** (`authManager.js:93-110`):
  shell `exec`, regex `Logged in to github.com account (…)`, two-line Active-account lookahead;
  username-class comment (`john.doe`) is itself invalid per GitHub rules. Prefer `gh auth status --json` / `gh api user`.
- **H4 — active account auto-clobbered — CONFIRMED** (`authManager.js:129-133`): persisted active
  missing from `discovered` (e.g. PAT host offline) → silently overwritten + persisted. Fix: default only when nothing persisted.
- **H6 — stale OAuth reuse edge — CONFIRMED, narrow** (`authManager.js:165-167,197`): native signed-out
  → `getSession` empty → falls through to `_tokenCache` entry stored at login → expired token sent once (then 401 surfaces). Don't cache native tokens.
- **H8 — stop(15s)/rebuild(60s) timeouts shorter than the operation — CONFIRMED**
  (`githubApi.js:131,165,217`): real rebuilds take minutes → false error while server-side succeeds. No destructive effect; confusing UX. 120s+ or poll state.
- **H12 — bare `JSON.parse` on PAT index — CONFIRMED** (`authManager.js:72,249,294` + outer
  `try/catch{}`): corrupt index → accounts silently missing / `logout` crash path. Safe-parse + repair.

### 2.3 Webview XSS gaps (real, low exploitability — one-line fix each)

- **H10 — CONFIRMED.** `sidebarProvider.js:1584-1624`: `metaLoaded` injects `spec/loc/timeAgo` and
  `data-cs="${msg.name}"` unescaped into `innerHTML`; `:1593-1602` builds
  `data-url="'+p.browseUrl+'"` and `Port … (visibility)` with zero escaping.
  POC: `browseUrl = 'https://" onmouseover="alert(1)'` → `data-url="https://" onmouseover="alert(1)"`.
  Qualification: URLs come from `gh codespace ports` (localhost/github.dev URLs); `openPortUrl` is
  gated to `https://` (`sidebarProvider.js:86-93`), which blocks `javascript:` but NOT attribute
  breakout — hence still worth fixing with the existing correct `escapeHtml` (`utils.js:7-15`).
  Dashboard card fields WERE verified escaped; no dashboard XSS found.

### 2.4 Dashboard health (all CONFIRMED, none crash-related)

- **D1** blank first paint (`dashboardProvider.js:13-50,150`): no skeleton before serial fetch. TRUE.
- **D2** logged-out dead end (`:159-162`): renders `buildDashboardHtml([],…)` → "No Codespaces found" (`:2026`) with zero `Sign In/loginGitHub/loginPat` affordances (grep: no matches). Sidebar has welcome/login; dashboard has none. TRUE, Medium.
- **D5** full-`html=` refresh wipes state (`:174` + sidebar `:129`): search/filter/grid/expanded/wizard all lost; no `getState/setState` anywhere (grep: no matches) despite `retainContextWhenHidden`. TRUE, Medium.
- **D6** timer refresh + dashboard never refreshed by host mutations: `setTimeout(refresh,1500/2000/2500)` (`dashboardProvider.js:42,48,79,132`; sidebar `:36,42,65`); `extension.js:431-432,454-455,472-473,529-530,586-587` refresh sidebar+statusbar only (create `:338-340`, switch `:276-278`, refresh `:233-235` do fan out to all three). TRUE, Medium.
- **D7** no message validation / no `default:` (`dashboardProvider.js:30-145`; sidebar `:25-112` same). Dashboard forwards raw `msg.account` (`:111`) vs sidebar's guarded `{account}`/undefined (`sidebarProvider.js:68`) — host falls back to QuickPick on undefined, so "works by accident". TRUE, Low.
- **D8** optimistic rebuild toast (`dashboardProvider.js:50-59`) before result + host toast duplication (`extension.js:501,504`). TRUE, Low.
- **D10** `fetchRepos` no try/catch (`dashboardProvider.js:116-124`; outer catch only `console.error` → webview stuck on loading); `submitCreate` (`:125-140`) calls API directly bypassing command validation; `branchInput value="main"` (`:2132`, read via `:2590`) means empty≠default-branch. TRUE, Medium/Low.
- **D11** serial `for…await listCodespaces` (dashboard `:165`; statusbar `statusBar.js:38-41`; `extension.js` quickConnect/testSSH/sync/startup) + triple-fetch on `refresh` (sidebar `refresh()` clears cache at `sidebarProvider.js:119`, then sidebar+dashboard+statusbar each refetch). Rate-limit/perf only. TRUE, Medium.
- Sidebar `fetchMeta` no try/catch (`sidebarProvider.js:106-111`) → drawer stuck on loading. TRUE, Low/Medium.
- Statusbar silent catch (`statusBar.js:50-52`). TRUE, Low.
- Dashboard has NO `openPortUrl`/`openExternal`/`loginGitHub` handler (grep: only `branchInput`/`fetchRepos` hits) — latent: any future dashboard UI posting those is silently dropped. Low (no current breakage; dashboard cards don't render port links).

### 2.5 Packaging / docs (CONFIRMED unless listed in §1)

- Uncommitted delta ~4041+/1003- across 10 files; `package.json` adds `defaultRemoteFolder` (diff verified) consumed at `extension.js:366-370` → tree is `5.0.0+dirty`. No `v5.0.0` tag (only `v4.3.0`, verified). Commit + tag to unblock `v*` release workflows. TRUE.
- Zero tests (`*.test.js`/`*.spec.js` glob empty), `package.json` has NO `scripts` (verified `null`). CI is build-only. TRUE — biggest process risk.
- README `:171` pins `antigravity-codespaces-4.3.0.vsix` (verified) while version is 5.0.0 → stale. TRUE.
- README badges advertise Marketplace/OpenVSX listings (`:15`) while Roadmap `:320` still ticks `VS Code Marketplace listing` as TODO → verify actual publish status; one of the two is stale. TRUE (needs human check of the marketplace URLs).
- `MARKETPLACE.md:26` references `4.3.0.vsix`; `:109` checkbox `Open VSX CI publish workflow` unchecked while `.github/workflows/open-vsx-publish.yml` exists. TRUE, trivial.
- `.vscodeignore` uncommitted additions (`*.docx, *.txt, desing.skill`, spec `.md` — diff verified). Typo artifact `desing.skill` (9,459 B, untracked, verified) — rename or confirm intentional. TRUE, trivial.
- `per_page=100` single page (`githubApi.js:39,302`) hides >100 repos/codespaces. TRUE, Medium/Low.
- Tier-3 launcher `exec()` with interpolation (`extension.js:414`) — prefer `execFile` argv. TRUE, Low.
- `findAntigravityExecutable` falls back to `code.cmd`/`code` (`sshManager.js:76,95-96,108,121`) → Tier 3 may open VS Code when Antigravity CLI is absent. TRUE quirk, Low/Medium UX.
- `StrictHostKeyChecking no` + `/dev/null` known-hosts (`sshManager.js:166-167`): accepted ephemeral-host tradeoff; scope + document. Info.
- `createCodespace` normalization gaps (`githubApi.js:333-342`): `owner`-only falls to CLI; `owner/repo/tree/main` silently uses default branch; branch untrimmed. TRUE, Low.
- `formatRelativeTime('not-a-date')` → `"NaNd ago"` (POC-verified; `try/catch` never fires since no throw). Cosmetic only. Low.
- `sortCodespaces` NaN comparator on malformed dates (`githubApi.js:96-102`): implementation-defined order, no crash. Low.
- `verifyPat` no timeout + 401/403/offline conflated (`authManager.js:269-281`): add `AbortSignal.timeout(8000)` + distinct messages. Medium/Low.
- `diagnose()` calls `getAccounts()` (`systemDoctor.js:57`, verified) → inherits cost + H4 side-effect; memoize. Medium/Low.
- Alias collision same-repo-suffix (`sshManager.js:139-142`): `cs-<acct>-<reposhort>` collides for same-account/different-owner same-repo-name; `Host cs.<name>` stays unique so connection works, alias is convenience-only. Low.
- SSH file handling: no `0600` enforce, no `.bak`, `trim()` full rewrite (`sshManager.js:180-184`); `aliveInterval/Max` unvalidated into config (`:156-159` — worst case one invalid host stanza, not system). Low.

## 3. Focus order (unchanged in substance, severities corrected)

1. `runCommand` rewrite (kill-on-timeout, execFile-only, stdout-only) — fixes JSON/token/zombie class at once.
2. SSH allowlist + regex escape + end-marker (C1/C2) — defense-in-depth, cheap.
3. Dashboard correctness: error-page `script-src` (S1), logged-out login CTA (D2), per-account error surfacing (S3), `postMessage` state updates instead of full `html=` (D5), await-then-refresh + host refreshes dashboard on all mutations (D6).
4. Auth/cache: lazy PAT verify (H2), no active-clobber (H4), account-key resolution + TTLs + `account` on CLI meta path (S2/S4), parallel fetches + debounce (D11).
5. XSS call sites (`escapeHtml` on meta/ports rows) + `verifyPat` timeout (H10 + utils note).
6. Release hygiene: commit, tag `v5.0.0`, rebuild vsix, fix README/MARKETPLACE refs, `desing.skill` typo, add `scripts.test` + lint + minimal unit tests (command parity, message round-trip, `escapeHtml`, `ensureSSHConfigEntry` golden file — string-level, no ssh writes) and gate CI.

*Verification method note: all POCs are pure in-memory string/logic reproductions; at no point
did verification write to `~/.ssh/config`, spawn `gh`, or mutate the repo. The only file created
in this pass is this document (+ the temp POC script outside the repo).*
