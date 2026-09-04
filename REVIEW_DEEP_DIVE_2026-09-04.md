# Antigravity Codespaces Pro v5.0.0 — Deep Review Findings (Read-Only, No Code Changed)

Date: 2026-09-04 | Scope: full project (`extension.js`, `src/*.js` ×8, `package.json`, docs, spec, CI, packaging) | Method: full file reads + 3 parallel specialist reviews + manual verification of load-bearing claims.

## 0. TL;DR

- **Happy path works:** login → list → connect/start/stop/delete, sidebar + Cloud Hub dashboard render, SSH sync, status bar counter. Core value proposition is intact.
- **Dashboard is NOT fully working:** it renders the happy path but is broken for logged-out users, partial per-account failures, first-load blank panel, dead error-page Retry button, lost UI state on every refresh, and stale grid after mutations. Details in §2.
- **Highest-blast-radius issues are outside the dashboard:** SSH config injection via unsanitized `cs.name` (`src/sshManager.js:143,151,163,165,176`), `runCommand` merging stderr→stdout + zombie processes + shell fallback (`src/utils.js:71-96`), and multi-account cache collision (`src/githubApi.js:29`). Fix these before any feature work.
- **No tests, broken CI check, dirty tree on top of v5.0.0, no v5.0.0 tag.** All quality gates are manual.
- **Nothing was changed.** This document is the only output.

## 1. Architecture & Logic (verified)

```
extension.js (activate: AuthManager, GithubApi, StatusBar, SidebarProvider, DashboardProvider, 17 commands)
  src/authManager.js (324L): native OAuth session + per-account PATs in secrets + `gh auth status` parse; getToken() fresh-native → _tokenCache → `gh auth token`
  src/githubApi.js (378L): REST-first + `gh` CLI fallback; _csCache keyed `account||'default'`; no TTL
  src/sshManager.js (211L): findGh/findAntigravity via execSync; ensureSSHConfigEntry() rewrites ~/.ssh/config block `# CS_ENTRY:<name>`; testSshTunnel() = `gh cs ssh -- echo ping_ok`
  src/utils.js (212L): escapeHtml (correct), generateNonce (correct), friendlyError (substring map), runCommand (execFile + shell fallback — buggy, see §3)
  src/systemDoctor.js (117L): diagnose() = gh --version + remote-ssh fuzzy match + getAccounts()
  src/sidebarProvider.js (1676L) + src/dashboardProvider.js (2710L): full-HTML webviews, nonce CSP, postMessage → extension commands
  src/statusBar.js (56L): online-count badge, silent catch
```

Command wiring: all 17 `contributes.commands` in `package.json:118-204` match `registerCommand` in `extension.js`. View `antigravity-codespaces-view` matches manifest + `registerWebviewViewProvider` (`extension.js:41-46`). Activation `onStartupFinished + onView` is correct but always-on (2s auto-sync, `extension.js:594-608`).

## 2. Dashboard Health — Is It Working Properly? NO for anything beyond happy path

Verified against `src/dashboardProvider.js`:

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| D1 | High | dashboardProvider.js:153-174 | Blank panel before first fetch — no skeleton/spinner. `openOrReveal()` awaits serial per-account fetches with empty webview. |
| D2 | High | dashboardProvider.js:159-162 | Logged-out / zero-account state is a dead end: calls `buildDashboardHtml([],…)` → "No Codespaces found / New Codespace" with no login CTA. Sidebar has `buildWelcomeHtml()`; dashboard has none. |
| D3 | High | dashboardProvider.js:164-172 + 202-213 | Per-account `error` collected (`all.push({…,error})`) but `buildDashboardHtml` destructures only `{account,type,codespaces}` — partial failures are silently dropped. No per-account error banner. |
| D4 | High | dashboardProvider.js:176-198 | Error-fallback page CSP is `default-src 'none'; style-src …` with **no `script-src`**, but Retry uses inline `onclick="vscode.postMessage…"` (:194) → **Retry button is dead**. Confirmed by read. |
| D5 | High | dashboardProvider.js:174, sidebarProvider.js:129 | Every refresh regenerates multi-thousand-line HTML (`webview.html = …`), wiping search `q`, filter, grid/list mode, expanded drawers, wizard state. `retainContextWhenHidden` is defeated by design. No `getState/setState`. |
| D6 | Medium | dashboardProvider.js:42,48,79 + sidebarProvider | Mutations use fixed `setTimeout(refresh,1500/2000/2500)` instead of awaiting the command + polling state. Too short → stale grid; too long → lag. `extension.js` start/stop/delete/create refresh sidebar+statusbar but **never dashboard** — dashboard relies on those timers. |
| D7 | Medium | dashboardProvider.js:30-145 | No message validation / no `default:` case. `switchAccount` forwards raw `msg.account` (may be undefined → accidental QuickPick). Dashboard sends bare string; sidebar sends `{account}` object — works by accident, not contract. |
| D8 | Medium | dashboardProvider.js:50-59 | `rebuild` toasts "Rebuild started" optimistically before result; real result already toasted by host. Duplicate/misleading toast on failure. |
| D9 | Medium | dashboardProvider.js:70-80 | `delete` always passes `confirmed:true`, bypassing host modal (`extension.js:517-524`). Sole confirmation is webview-side; compromised webview = unconfirmed delete. Host should re-confirm. |
| D10 | Medium | dashboardProvider.js:125-140, :2125 | `submitCreate` bypasses `createCodespace` command validation; wizard branch defaults to `value="main"` so "empty = default branch" never exercised. `fetchRepos` has no try/catch — throw leaves webview stuck on "Loading repositories…" (:2106). |
| D11 | High (perf) | dashboardProvider.js:165-168, statusBar.js:38-41, extension.js:82-84,193-196 | Serial `for…await listCodespaces(account)` everywhere + `refresh` fans out to sidebar+dashboard+statusbar each refetching → 3× API traffic, N sequential round-trips. Use `Promise.all` + debounce. |
| D12 | Low | dashboardProvider.js:2678-2699 | `localStorage` theme works only via `retainContextWhenHidden`; full `html=` reset flashes `data-theme="light"` (:459) before restoring. |

Sidebar is healthier (error/empty/no-match views present) but shares D5/D6/D11 and has its own gaps: no loading state on `render()`, `fetchMeta` without try/catch leaves drawer on "Loading machine specs…" forever (sidebarProvider.js:106-111).

## 3. Critical / High Findings Outside Dashboard (focus here first)

### Critical

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| C1 | Critical | sshManager.js:143,151,163,165 | **SSH config injection via `cs.name`.** `Host cs.${cs.name}`, `ProxyCommand "…" cs ssh -c "${cs.name}"`, `Host … ${rawName}` interpolate unsanitized API data. `"`/newline in name breaks out → arbitrary SSH directives. `safeAccount`/`repoShort` are sanitized; `cs.name` is not. Allowlist `^[A-Za-z0-9-_]+$`, reject newlines/quotes. Verified by read. |
| C2 | Critical | sshManager.js:151,176 | Block-strip regex `new RegExp(`\\n*${blockId}[\\s\\S]*?TCPKeepAlive yes…`)` uses unescaped `cs.name`; non-greedy match to first `TCPKeepAlive yes` can delete wrong range or leave duplicates. Escape regex + end-marker delimiter. Verified. |
| C3 | Critical | githubApi.js:29-30,119,132,155 | **Cache collision across accounts.** Key `account \|\| 'default'` means unspecified-account calls from A and B share one key; switching accounts returns stale other-account list; invalidation deletes the wrong key. Resolve `account ?? getActiveAccount()` before keying. Verified. |
| C4 | Critical | utils.js:71-96 + githubApi.js:86,237,287,320 | `runCommand` resolves `(stdout + stderr).trim()` → `gh` warnings corrupt `JSON.parse` → silent `[]`/`{}`. Return stdout-only; surface stderr on error. Verified. |

### High

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| H1 | High | utils.js:71-96 | Timeout rejects but never kills child → zombie `gh` procs. Any `execFile` error unconditionally re-runs via shell `exec` (double billing/rate-limit). Shell quoting `"${a.replace(/"/)}"` unsafe on POSIX (`$(…)` executes in double quotes). Use `execFile` only + `AbortSignal.timeout()`. Verified. |
| H2 | High | authManager.js:78 | `getAccounts()` live-`verifyPat()`s every stored PAT on every call → slow startup, rate-limit burn, accounts vanish offline → active-account flap (H4). Trust index; verify lazily with TTL. |
| H3 | High | authManager.js:93-110 | `gh auth status` via shell `exec` + regex `Logged in to github.com account (…)` + two-line Active-account lookahead — breaks on locale/format change; username class wrong (GitHub logins: alphanumerics+hyphens, ≤39ch; comment's `john.doe` invalid). Prefer `gh auth status --json` / `gh api user`. |
| H4 | High | authManager.js:129-133 | Persisted active not in `discovered` (e.g. PAT offline) → silently clobbered to `discovered[0]` + persisted. Flapping. Only default when nothing persisted. Verified. |
| H5 | High | authManager.js:52-56,154-162 | Single native OAuth session only — 2nd native account invisible; `getToken` pays `getSession` cost even for PAT/CLI targets. Enumerate `getSessions` or document limit. |
| H6 | High | authManager.js:65,165,197 | `login()` caches OAuth token contradicting "don't cache" comment; `getToken` returns `_tokenCache` entry after native session vanishes → expired reuse. Don't cache native tokens. |
| H7 | High | githubApi.js:229-293 | `ports`/`meta` caches never invalidated (except `clearCache`), no TTL; REST path returns normalized object, CLI path returns raw `gh view --json` (different keys) → shape-dependent breakage. Add TTL + normalizer. |
| H8 | High | githubApi.js:131,165,217 | `stop` 15s / `rebuild` 60s timeouts shorter than real operations (rebuild = minutes) → false errors while server-side succeeds. 120s+ or poll state. |
| H9 | High | systemDoctor.js:57 | `diagnose()` calls `getAccounts()` (7s `gh` + N PAT verifies, with H4 side-effect) on every dashboard render path. Read-only snapshot + 30-60s memo. |
| H10 | High | sidebarProvider.js:1591-1602,1606-1624 | **XSS gaps (the one place escaping was missed).** `metaLoaded` injects `spec/loc/timeAgo` + `data-cs="${msg.name}"` unescaped into `innerHTML`; ports rows build `data-url="'+p.browseUrl+'"` + `Port … (visibility)` with zero escaping. `escapeHtml` itself is correct — these call sites just don't use it. Verified by read. |
| H11 | High | extension.js:412 | `fs.existsSync(ANTIGRAVITY_EXE)` with no null-guard; `undefined` → TypeError caught as generic "Connection error". Guard `if (ANTIGRAVITY_EXE && …)`. |
| H12 | High | authManager.js:72,248,293 | Bare `JSON.parse` on PAT index → corrupt index orphans secrets / crashes `logout`; outer `try/catch{}` hides it. Safe-parse + repair + alert. |

Medium (condensed): silent `catch{}` everywhere (authManager, githubApi); `verifyPat` no timeout + 401/403/offline conflated; PAT prefix allowlist rejects valid `ghu_/ghs_/ghr_` + fine-grained variants; new PAT login doesn't become active (`_activeAccount || login`); `clearCache` doesn't reset `_activeAccount`/API caches; `logout` doesn't clear API cache; CLI token cached forever, 401 never evicts, REST non-ok falls through to CLI instead of surfacing 401/402/429; `createCodespace` validation gaps (trailing `/tree/main`, owner-only, untrimmed branch); `fetchUserRepos` capped at 100 no pagination (also breaks repo picker completeness); sync `execSync` discovery on hot path; `StrictHostKeyChecking no` + `/dev/null` known-hosts MITM-blind (scope + note it); `friendlyError` substring collisions + raw-output leak; `formatRelativeTime` NaN path; `findAntigravityExecutable` falls back to `code.cmd` (opens VS Code instead of Antigravity); no `gh` min-version pin. Low: alias collision same-repo-suffix; SSH perms/backup/concurrent-write; unvalidated aliveInterval/Max; sort NaN dates; fire-and-forget `executeCommand`/`openExternal`; unawaited refresh trio race; theme flash; `serverAliveInterval` change triggers unrelated network refresh.

Token storage verdict: reasonable (PATs in `context.secrets`/OS keychain, per-account keys, `password:true`, no token in logs) with caveats — plaintext in-memory `_tokenCache` never wiped on lock, `GH_TOKEN` env fanned out to every `gh` spawn, OAuth token unnecessarily cached, shell-fallback error echo risk.

## 4. Packaging / Docs / CI

- Dirty tree ships ≠ packaged vsix: `git status` shows `M .vscodeignore, extension.js, package.json, src/*.js` + untracked spec `.md`/`.docx`/`desing.skill`/`docs/AUDIT_REPORT.md`/`docs/UI_CONTENT_*.md`. Both committed `.vsix` (4.3.0 272KB, 5.0.0 304KB) built from older tree — rebuild after commit. Verified.
- `*.vsix` tracked despite `.gitignore` listing `*.vsix` (~577KB bloat) — `git rm --cached *.vsix` (Releases only) or drop the rule.
- Typo artifact `desing.skill` (+ matching `.vscodeignore` entry) — rename/confirm.
- No `scripts`, no `devDependencies`; CI uses unpinned `npx @vscode/vsce` / `npx ovsx` — drift risk. CI uses `--allow-missing-repository --skip-license` which masks real metadata errors despite LICENSE+repository existing.
- Only tag is `v4.3.0` — **no `v5.0.0` tag** (verified `git tag --list`), yet `package.json`/`CHANGELOG` claim 5.0.0 and release workflows trigger on `v*`. Working tree is effectively `5.0.0+dirty` (`defaultRemoteFolder` config added uncommitted, consumed in `extension.js:366-370`). Commit + tag to unblock releases.
- README stale: install pins `4.3.0.vsix` (:171); badges claim live Marketplace listing while Roadmap lists it unchecked — clarify.
- Spec drift (4037-line pixel-perfect spec vs implementation): `window.prompt()`-style wizard input blocked in sandbox, `per_page=100` single page, Tier-3 launcher `exec()` interpolation (use `execFile`), static KPI Tile 4 (`15 GB Free Tier`) vs FR-02 live quota, in-webview left rail vs Activity-Bar architecture — amend spec or implement; copy drift in empty-state strings.
- **Zero tests** (no `*.test.js`, no `scripts.test`); CI is build-only and runs `node -c extension.js` — Node has no `-c` flag (correct: `node --check`), so workflows fail on a healthy tree. Missing: test/lint/`vsce ls` assert/`ovsx` dry-run/secret-scan/CodeQL/Dependabot + webview contract tests (message names, CSP-nonce, `escapeHtml`, `ensureSSHConfigEntry` golden file).

## 5. What To Focus On Next (ordered)

1. **SSH injection + regex (C1,C2)** — arbitrary SSH-directive blast radius; allowlist + escape + end-marker.
2. **`runCommand` rewrite (C4,H1)** — kill-on-timeout, no shell fallback, stdout-only; fixes JSON/token/zombies in one shot.
3. **Dashboard correctness (D2,D3,D4,D5,D6)** — login CTA, per-account errors, working Retry (script-src+listener), `postMessage` state updates instead of full `html=`, await-then-refresh instead of timers, host-side refresh for all mutations + `onAuthChanged` fan-out to dashboard/statusbar.
4. **Cache correctness (C3,H7)** — resolve account before keying, TTLs, REST/CLI shape normalizer, `Promise.all` + debounce (D11).
5. **Auth robustness (H2,H4,H5,H6,H12)** — lazy PAT verify, never auto-clobber active, multi-native story, safe JSON index, don't cache native tokens.
6. **XSS call sites (H10)** — `escapeHtml` the `metaLoaded`/ports injection points.
7. **Release hygiene** — fix CI `node --check`, commit dirty tree, tag `v5.0.0`, update README vsix ref, decide `*.vsix` tracking, fix `desing.skill` typo, add `scripts.test`+lint+minimal unit tests and gate CI.
