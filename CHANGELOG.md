# Changelog

All notable changes to the **Antigravity Codespaces Pro** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [5.3.1] - 2026-10-21

### Fixed
- Every GitHub API request now times out after 15s ("GitHub isn't responding (15s)." [Retry] [Work offline]). Server errors (5xx) are retried once after 5s, then reported as "GitHub is having trouble right now." [Retry] [GitHub Status].
- Connect waits for the IDE launcher to start. If it fails: "Couldn't open <repo> in this IDE." [Run Setup Doctor] [Copy SSH command], and the card goes back to Available.
- Reconnect shows the real reason when the codespace can't be started (deleted, quota) and skips SSH.
- Empty `catch {}` blocks replaced with logging; failures in user actions are shown to the user.
- Setup Doctor recognises Windsurf's built-in Remote SSH (`codeium.windsurf-remote-openssh`) and no longer suggests conflicting extensions there.
- Keep-alive guide uses `StrictHostKeyChecking accept-new`; SECURITY.md and CONTRIBUTING.md updated from 4.3.x.

- Usage: a malformed billing response (or a non-numeric quantity) shows "Usage data unavailable (unexpected response)" instead of 0 or NaN.
- Usage: an expired sign-in (401 from `/user`) shows "GitHub sign-in expired" with [Sign in again]. A 403 or 404 when the `user` scope is already present now gets its own message (SSO / fine-grained token, or not on the enhanced billing platform).
- Usage: a rate limit (429, or 403 with no remaining requests) shows when usage can refresh, read from the rate-limit headers.
- Usage: offline with nothing cached shows the offline banner instead of raw error text.
- Usage: if daily usage or the previous month fails to load, a warning note appears in that section instead of the section silently disappearing.
- Usage: if the codespaces list can't be loaded, the account is no longer treated as org-billed; the page says it's unknown.
- API rate limits: a 403 with `x-ratelimit-remaining: 0` is treated as a rate limit (like 429) for list/start/stop/create, with the reset time.
- Error messages match exact HTTP status / exit code fields instead of any "404", "255" or "exceeded" in the text.
- The sidebar uses the new error UI too: cached cards are tagged, dimmed and have their actions disabled, and the signed-out screen is a single sign-in card (the hardcoded "60 free compute hrs / month" is gone).
- The unexpected-response usage error has [Retry] and [Details]; technical detail goes only to the log.
- The storage tile no longer shows a hardcoded "15 GB Free Tier". It shows the plan's included storage from GitHub, or is hidden.

### Changed
- Sidebar: skeleton on first load, error banner over the last cached list ("as of <time>"), classified error card, "No codespaces yet." copy.
- Cloud Hub: the signed-out state is a single full-page card (tiles, account chips and search are hidden). Cached cards get a "Cached" tag, are dimmed, and have Connect/Start/Stop disabled until a refresh succeeds. Running cards keep only quick actions in the card; the rest are in the ⋮ menu. The rail shows the real extension version. "Enterprise Edition" subtitle removed.
- Error levels: Critical (error notification + red banner), Warning (amber Cloud Hub banner: cached/offline data, missing scope, near quota), Info, Silent (log only). Banners have an icon + text label, a Details button that opens the log, and can be dismissed (they come back on the next refresh if the problem remains).
- Cloud Hub: skeleton cards while loading; "No codespaces yet." [Create codespace]; signed-out card [Sign in with gh]; a failed refresh keeps the last list with "Showing data as of <time>"; busy buttons show a spinner.

## [5.3.0] - 2026-10-21

### Added
- **Deeper usage analytics (Usage page):** month switcher (last 6 months) with month-over-month comparison; projection line ("At this pace: ~X core-hrs by reset, won't run out" / "runs out ~date"); hours left per machine size (2/4/8/16/32-core); separate compute and storage daily charts with hover tooltips (hours and $) and a Month/7-day toggle; cumulative vs pace chart; peak day, active days, today.
- Per-repository table with expandable SKU breakdown, sparkline, sorting and filter; CSV/JSON export of the billing rows.
- Storage tip naming the top storage repository (stopped codespaces still bill storage); links to GitHub billing, spending limit, idle timeout and docs.
- Settings: `usage.alertThresholds` (default 75/90% notifications, once per month), `usage.refreshMinutes`, `usage.showSidebarLine`, `usage.preferredUnit` (core-hours or dollars).
- Every derived figure is labelled and has a tooltip with its source/formula.

### Docs
- New multi-IDE setup guide (`docs/IDE_SETUP.md`) and copy-paste agent setup prompt (`AGENT_SETUP.md`), linked from the README and the Cursor guide.

### Fixed
- CSV export guards against spreadsheet formula injection.
- The 7-day average now counts days elapsed in the cycle, not days since first usage (overstated burn rate after idle days).
- "Full cycle" wording replaced with an explicit projection.

### Known issue
- In 5.3.0 a malformed or unexpected billing response could show 0 core-hours instead of an error, GitHub requests had no timeout, and some billing errors (expired sign-in, 403/404, rate limit, offline) showed unclear messages. Fixed in 5.3.1.

## [5.2.0] - 2026-10-21

### Added
- **Codespaces usage analytics** for the active gh account (follows account switches):
  - **Cloud Hub**: a full-width usage card above the KPI grid with separate **Compute** (core-hrs, $ of included value) and **Storage** (GB-month) bars that turn orange at 75% and red at 90%. It also shows hours left, days left and a billing line (consumed / included discount / billable). The Storage Tier card shows real `x / y GB-month`. A new **Usage** page in the left rail has tiles (used, remaining, avg/day, days left, storage, reset date), a daily chart with an ideal-pace line and a sortable per-repository table (core-hrs, storage, share, amount). It shows "Updated hourly · last fetched HH:MM".
  - **Sidebar**: one compact usage line under the account picker. Clicking it opens the Cloud Hub Usage page.
  - "Usage needs permission" + **Grant access** (`gh auth refresh -h github.com -s user`) when the billing API returns 403/404 without the `user` scope.
  - Numbers come only from GitHub's billing API (summary + daily usage) and match github.com/settings/billing. There are no estimates: if the API fails, the card shows "Usage unavailable" with the reason and the gh command. Org-billed codespaces show as "Billed to {org}".
  - An **offline** note keeps the last good numbers when the network drops.
- Settings: `usage.plan` (auto/free/pro/custom), `usage.monthlyCoreHours`, `usage.monthlyStorageGb`. Commands: Refresh Usage and Grant Usage Access.
- Research notes and an API-vs-billing-page POC in `docs/USAGE_ANALYTICS_RESEARCH.md` (`scripts/usage-poc.js`), plus real API fixtures in `test/fixtures/`.

## [5.1.0] - 2026-10-21

### Added
- **Setup Doctor Command (issue #4)**: New `antigravity-codespaces.setupDoctor` command runs comprehensive environment diagnostics — checks GitHub CLI installation, SSH client, Remote-SSH extensions, and authentication state with one-click fix actions.
- **Sidebar gh CLI Status Indicator (issue #4)**: Real-time gh CLI auth status displayed in the sidebar header; shows logged-in user or "signed out" with quick-fix links.
- **First-Run Welcome Card (issue #4)**: Three-step onboarding card (Sign In → Install gh CLI → Connect) persisted via globalState; auto-dismisses after first successful connection.
- **Connect Progress Indicator (issue #4)**: Connection operations now show a progress notification with the target Codespace name.
- **Real Remote Folder Detection (issue #4)**: Connect resolves the actual workspace folder from `recentFolders` or devcontainer metadata instead of always defaulting to `/workspaces/${repo}`.
- **"Connect Now" Button (issue #4)**: Available state cards show a prominent Connect button alongside Start/Stop.
- **Reconnect Command (issue #4)**: New `antigravity-codespaces.reconnect` command re-establishes SSH tunnel to the most recently connected Codespace.
- **Diagnostic Report with Token Redaction (issue #4)**: Setup Doctor can generate a shareable diagnostic report; OAuth tokens (`gho_*`), GitHub App tokens (`ghu_*`, `ghs_*`, `ghr_*`), and PATs (`ghp_*`) are automatically redacted.

### Changed
- **Shared gh CLI Preflight (issue #3)**: Connect, Quick Connect, and Test SSH now share a unified preflight that detects all four gh CLI auth failure states (missing, logged out, scope missing, user mismatch) with one-click terminal fixes before attempting SSH.
- **Auto-Fix `remote.SSH.remotePlatform` (issue #3)**: Connect automatically sets `remote.SSH.remotePlatform[<host>]` to `"linux"` for Codespace hosts, preventing exit-127 failures when Remote-SSH defaults to Windows/macOS.
- **Bare Exit-127 Detection on Codespace Hosts (issue #3)**: `isPlatformMismatchError` now treats a bare exit code 127 (no powershell text) as a platform mismatch when the host alias starts with `cs.`.
- **Smarter gh auth switch Fallback (issue #3)**: When `gh auth switch` fails, the terminal command offered depends on the error — fresh login for zero/unknown accounts, re-switch for transient failures.

### Security
- **SSH Host Key Verification (issue #5)**: Replaced `StrictHostKeyChecking no` + `UserKnownHostsFile /dev/null` with `StrictHostKeyChecking accept-new` and an extension-managed `~/.antigravity-codespaces/known_hosts` file. Host keys are stored persistently (TOFU model); subsequent key changes trigger warnings.
- **Configurable `StrictHostKeyChecking` (issue #5)**: New setting `antigravity-codespaces.strictHostKeyChecking` (`accept-new` | `yes` | `no`).
- **Configurable SSH Log Level (issue #5)**: New setting `antigravity-codespaces.sshLogLevel` (`quiet` | `error` | `info` | `verbose`); default changed from `quiet` to `error` so fatal conditions surface.
- **Shared "Codespaces" Output Channel (issue #5)**: Every `~/.ssh/config` mutation and `remote.SSH.remotePlatform` change is logged with timestamps. No tokens or secrets are logged.

### Fixed
- Exit-255 "nonexistent pipe" errors now surface actionable gh CLI auth guidance instead of opaque SSH failures (issue #3).
- Tunnel stderr is captured and parsed for known failure signatures (gh auth, scope missing, platform mismatch) with context-specific fix buttons (issue #3).
- Multi-account `gh auth status` scope parsing now anchors to the exact account block, preventing scope leakage between accounts (issue #3).
- Scope parsing fails open (proceeds with connection) when scopes are unparseable (fine-grained PAT, GH_TOKEN env var) instead of blocking (issue #3).

---

## [5.0.9] - 2026-10-20

### Security
- **SSH Host Key Verification (issue #5)**: Replaced `StrictHostKeyChecking no` + `UserKnownHostsFile /dev/null` with `StrictHostKeyChecking accept-new` and an extension-managed `~/.antigravity-codespaces/known_hosts` file. Host keys are now stored persistently (TOFU model) and subsequent key changes trigger warnings. Configurable via `antigravity-codespaces.strictHostKeyChecking` (`accept-new`|`yes`|`no`).
- **SSH Log Level Control (issue #5)**: Changed default SSH `LogLevel` from `quiet` to `ERROR` so fatal conditions are surfaced. Configurable via `antigravity-codespaces.sshLogLevel` (`quiet`|`error`|`info`|`verbose`).

### Added
- **Shared 'Codespaces' Output Channel**: Every `~/.ssh/config` mutation (block creation, update, removal) is now logged with timestamps to a dedicated "Codespaces" output channel. Also logs `remote.SSH.remotePlatform` changes. No tokens or secrets are logged.
- **`mapTunnelError(stderr, exitCode, host)` Function**: Pure exported function that maps SSH tunnel/test failures to actionable user guidance:
  - `gh auth login` / `not logged into any GitHub hosts` → "GitHub CLI is not logged in"
  - `needs the "codespace" scope` / `Must have admin rights` → missing scope guidance (shown first)
  - Exit 127 + `powershell: command not found` → remote platform mismatch
  - `nonexistent pipe` / exit 255 → tunnel died, likely gh auth issue
  - `REMOTE HOST IDENTIFICATION HAS CHANGED` → offer to remove host from managed known_hosts
- **`buildSshConfigBlock(opts)` Function**: Pure exported function for generating SSH config blocks, enabling easier testing and customization.
- **Host Key Removal Action**: When host key verification fails, "Test SSH Connectivity" now offers a "Remove Host Key" button to clear the stale key from the managed known_hosts file.
- **New Settings**:
  - `antigravity-codespaces.strictHostKeyChecking`: `accept-new` (default), `yes`, or `no`
  - `antigravity-codespaces.sshLogLevel`: `quiet`, `error` (default), `info`, or `verbose`

### Changed
- **Existing SSH blocks are rewritten on next `ensureSSHConfigEntry`** to apply the new security settings (accept-new + managed known_hosts + LogLevel ERROR).
- **Test SSH Connectivity** now shows stderr details and offers context-specific fix buttons (Fix Remote Platform, Remove Host Key, Run Fix Command).

### Fixed
- SSH tunnel errors now route through `mapTunnelError` for consistent, actionable messaging instead of raw exit codes.

---

## [5.0.8] - 2026-09-05

### Added
- **Cursor IDE / Anysphere Remote SSH Command Probes**: Added `anysphere-remote-ssh.connectToHostInNewWindow` and `anysphere-remote-ssh.connectHost` to Tier-2 remote SSH connection resolver, ensuring bulletproof native window spawning inside Cursor IDE.
- **Deep-Dive Technical Documentation Suite**: Added comprehensive developer guides:
  - `docs/CURSOR_IDE_CODESPACES_GUIDE.md`: Step-by-step setup, Open VSX installation, and port forwarding in Cursor.
  - `docs/AI_AGENT_KEEP_ALIVE_GUIDE.md`: Technical analysis of SSH idle sockets, keepalive tuning, and long agent session persistence.
  - `docs/MULTI_ACCOUNT_MANAGEMENT.md`: Architectural overview of OS keyring token isolation and safe multi-account switching.
- **Repository Optimization**: Removed deprecated binary and draft specification files, streamlining the extension repository and reducing package size.

## [5.0.7] - 2026-09-05

### Enhanced
- **Cursor IDE & Universal Open VSX Search Discovery**: Expanded metadata, documentation, and keyword taxonomy specifically optimized for Cursor IDE (`cursor`, `cursor-ide`, `cursor-codespaces`, `cursor-agent`), Windsurf, VSCodium, Antigravity IDE, and Code-OSS.
- **AI Agent KeepAlive & Session Persistence Documentation**: Added deep-dive architectural guidelines and configuration reference for keeping long-running AI agent sessions (Cursor Agent, Antigravity Agent, Claude Code, Aider) connected over SSH without idle tunnel drops.
- **Comprehensive README Overhaul**: Redesigned documentation with editor compatibility matrix, quickstart workflows for Cursor and Antigravity, zero-password key handling explanations, and FAQ for search engine optimization (SEO) and generative engine optimization (GEO).

## [5.0.6] - 2026-09-05

### Fixed
- **Codespaces SSH IdentityFile & Askpass Password Prompt**: Explicitly specified `IdentityFile ~/.ssh/codespaces.auto` in generated OpenSSH host configuration blocks and eliminated destructive stripping in cleanup routines, preventing OpenSSH from attempting irrelevant user keys and prompting for a non-existent container password.

## [5.0.5] - 2026-09-05

### Fixed
- **CLI Active Account Scope ReferenceError**: Declared `cliActive` before the discovery `try` block and populated it from active account blocks, eliminating a potential `ReferenceError` during CLI account discovery when no active account was previously persisted.
- **Content Security Policy Hardening**: Replaced inline `onerror` fallback handlers on user and account avatars with nonced DOM event listeners, ensuring 100% strict CSP compliance and zero webview console warnings.
- **Offline Testability & Contract Verification**: Made `AuthManager` constructor resilient in non-VSCode test environments and added automated static contract tests verifying zero inline event handlers across all webview providers.

## [5.0.4] - 2026-09-05

### Fixed
- **Per-Account Scope Attribution**: Partitioned multi-account `gh auth status` output to accurately associate OAuth token scopes and active states per discovered account.
- **Combined Scope Error Matching**: Combined REST and CLI error messages in `buildListError` ensuring missing `codespace` scope guidance is never suppressed by generic CLI errors.
- **Billing Error Precedence**: Reordered `friendlyError` checks so spending/quota limits are properly identified and surfaced before generic HTTP 403 access denial.
- **Deterministic Test Harness**: Hardened unit test suite assertions for multi-account CLI fallback environments.

## [5.0.3] - 2026-09-05

### Fixed
- **Fatal ReferenceError (`restErr is not defined`)**: Declared `let restErr = null;` in `listCodespaces(account)` and recorded non-200 REST responses so token scope/permission failures never crash with a runtime ReferenceError.
- **GitHub CLI shorthand deprecation**: Replaced deprecated `-r` with `-R` (and added `--default-permissions`) in `createCodespace`.
- **Non-interactive TTY machine prompt crash**: Passed default machine tier (`-m basicLinux32gb`) during headless CLI fallback creation to prevent `error getting machine type: no terminal`.
- **Misleading Rate-Limit error labels**: Refined `friendlyError` so 403 missing OAuth scope errors (`needs the "codespace" scope`) guide the user to `gh auth refresh -s codespace` rather than masquerading as an API rate limit.
- **CLI Scope Detection**: Added `hasCodespaceScope` detection in `authManager.getAccounts()`.

## [5.0.2] - 2026-09-05

### Fixed
- **Connect killing bug (live-test finding)**: `gh cs ssh` authenticates as the CLI's
  active user, so connecting to another account's Codespace died with HTTP 404 /
  exit 255. Connect now pre-flights the gh identity and offers one-click
  **Switch gh CLI & Retry** instead of a cryptic SSH failure.
- **Stale SSH config generations**: auto-purge of unmarked legacy blocks and phantom
  `codespaces.auto` keys on every Sync/startup (with `.pre-cleanup.bak` backup);
  END markers now match by codespace name so foreign markers can't shield old blocks.
- **Palette dead ends**: Start/Stop/Rebuild/Delete/Copy SSH/Open in Browser invoked
  without a card context now ask which Codespace (shared picker); Connect opens
  Quick Connect instead of silently doing nothing.
- **Create guards**: `owner/repo` validated inline at input; warns when creation would
  silently fall back to the gh CLI under the wrong account.
- Start on an already-running Codespace now says so instead of a misleading toast.

### Added (normal-user guidance — no silent failures anymore)
- **Output channel + Show Logs**: every operation error logs full context to the
  "Antigravity Codespaces" channel and offers a Show Logs button on the toast.
- **Guided error texts**: 404 explains owner-only access + wrong-gh-account switch;
  boot timeouts explain Start-and-wait; missing container SSH server points to the
  devcontainer sshd feature; dropped tunnels explain RUNNING/account/log checks.
- **Total list failure surfaces**: empty states, banners, tooltips, and pickers now
  distinguish "no machines" from "couldn't load" (with Retry), and Sync reports
  per-account skips instead of a blanket success.
- **Stopped-machine SSH test**: offers Start Now instead of a cryptic probe failure;
  terminal fallback explains itself with a Test SSH pointer.

## [5.0.1] - 2026-09-04

### Security
- SSH config injection hardening: Codespace names are allowlist-validated before any
  `~/.ssh/config` write; block-strip regex is escaped with an explicit end marker.
- Webview XSS gaps closed: sidebar machine/ports metadata and dashboard repo lists are
  HTML-escaped at every injection point.
- CLI runner no longer uses a shell fallback: `execFile` argv only, stdout-only capture,
  child killed on timeout.

### Fixed
- Cloud Hub error page Retry button now works (missing `script-src` CSP directive added).
- Dashboard shows a Sign In call-to-action when logged out instead of a dead end.
- Per-account load failures surface as banners instead of silently showing empty lists.
- Dashboard preserves search text, account filter, and grid/list mode across refreshes.
- Start/stop/delete/rebuild/connect/sync now refresh the dashboard too (was sidebar only).
- Dashboard/sidebar no longer show stale data after login/logout (auth-change fan-out).
- `stop`/`rebuild` timeouts raised (30s/180s) to match real operation durations.
- PAT accounts survive offline (lazy re-verify with 10-min TTL, offline tolerance).
- Active account is never auto-clobbered when an account is temporarily undiscoverable.
- `fetchUserRepos`/`listCodespaces` paginate (up to 500) instead of capping at 100.
- `createCodespace` validates `owner/repo` format and trims the branch input.
- Serial per-account fetching replaced with parallel fetches; status bar debounced.
- `formatRelativeTime` returns `N/A` for invalid dates instead of `NaNd ago`.

## [5.0.0] - 2026-09-04

### Added
- **Zero-CLI REST API Core**: Direct HTTPS integration (`https://api.github.com/user/codespaces`) using native `fetch` — list, start, stop, rebuild, delete, and create without requiring GitHub CLI pre-installed.
- **Native VS Code GitHub OAuth**: Seamless login via `vscode.authentication.getSession('github')` with zero terminal popups.
- **Encrypted PAT Support**: Corporate and proxy-safe Personal Access Token login backed by VS Code's encrypted `context.secrets` API.
- **System Doctor Diagnostics**: Pre-flight environment inspector detecting GitHub CLI, OpenSSH client, Remote SSH extensions, and active accounts with one-click install recommendations.
- **Smart Onboarding Welcome View**: Comprehensive first-time setup guide explaining Codespaces, free tier quota, direct sign-in, and system prerequisite checklist.
- **Strict Content Security Policy (CSP)**: Hardened all webviews with cryptographically random nonces and comprehensive HTML entity sanitization.
- **Cross-Platform Binary Discovery**: Automated path discovery for GitHub CLI and Antigravity IDE on Windows, macOS (Apple Silicon & Intel Homebrew), and Linux.

### Fixed
- **BUG-01**: Fixed fatal login crash on clean machines lacking `gh` CLI in PATH by adopting native OAuth.
- **BUG-02**: Fixed unhandled `ReferenceError: ANTIGRAVITY_EXE is not defined` in connection fallback.
- **BUG-03**: Initialized `GH_PATH` dynamically via `findGhExecutable()` rather than a static string.
- **BUG-04**: Eliminated hardcoded developer laptop directories (`C:\Users\lenovo\...`) from production code.
- **BUG-05**: Removed personal GitHub handle (`Nir-Bhay`) fallback in SSH config host alias generator.
- **BUG-06**: Cleaned up SSH config generation to remove non-existent `~/.ssh/codespaces.auto` key dependencies.
- **BUG-07**: Fixed `getAccounts()` failure by parsing both stdout and stderr from `gh auth status` without failing on exit code 1.
- **BUG-08**: Added complete macOS and Linux binary path resolution.
- **BUG-09**: Automatic token cache invalidation on refresh, account switch, and logout.
- **BUG-10**: Replaced 30-second SSH tunnel wake probe (`echo up`) with instant REST API calls (`POST /user/codespaces/{name}/start`).
- **BUG-11**: Added live listener for `vscode.workspace.onDidChangeConfiguration`.
- **BUG-12**: Implemented proper state teardown and cache clearing in `deactivate()`.
- **BUG-13**: Replaced global boolean connection lock with a per-container concurrency Set.
- **BUG-14**: Added interactive sign-in options to the Quick Actions menu when unauthenticated.
- **BUG-15**: Corrected multiple `acquireVsCodeApi()` calls in webviews.
- **BUG-16**: Fixed `gitStatus.ref` fallback to prevent mislabeling custom branches as `'main'`.

---

## [4.3.0] - 2026-08-25

### Added
- **Quick Connect (`Alt + C`)**: Instant fuzzy-search launcher across all authenticated accounts with one-keystroke connection.
- **Status Bar Integration**: Real-time status bar widget displaying online container count (`$(cloud) Codespaces: N Online`) with interactive quick-action menu.
- **Built-in SSH Latency & Health Tester (`antigravity-codespaces.testSSH`)**: Non-destructive tunnel probe measuring roundtrip ping in milliseconds.
- **Dynamic KeepAlive Engine**: Configurable `serverAliveInterval` and `serverAliveCountMax` settings to eliminate WebSocket drops during long AI agent sessions.
- **Dynamic Path Discovery**: Auto-detects `gh.exe` and `antigravity-ide.cmd` across standard Windows Program Files, LocalAppData, and Scoop shims.
- **Keyboard Shortcuts in Cloud Hub**: Press `/` to focus search and `Escape` to clear.

### Changed
- Refactored all background querying to use isolated Bearer Tokens (`GH_TOKEN`) instead of global CLI switching.
- Enhanced Bento Cloud Hub dashboard with inline SSH test button.
- Comprehensive expansion of technical documentation and architecture diagrams.

---

## [4.2.4] - 2026-08-25

### Added
- Multi-account simultaneous discovery (`baythe19`, `Nir-Bhay`, `octocat`, `octocat2`).
- OpenSSH `~/.ssh/config` block generator with auto-deduplication.
- Live Forwarded Port detection with 1-click external browser links.

---

## [4.0.0] - 2026-08-24

### Added
- Bento Grid Cloud Hub webview dashboard with dark/light mode toggle.
- Create Codespace wizard with direct GitHub API repository and branch picker.
- DevContainer Rebuild support (Standard vs Full clean rebuild).
- Permanent sidebar tree actions (Connect, Turn ON, Stop, Open in Web, Delete).
