# Changelog

All notable changes to the **Antigravity Codespaces Pro** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
- Multi-account simultaneous discovery (`baythe19`, `Nir-Bhay`, `abhayhiwse-hub`, `teamwebstarts-cmyk`).
- OpenSSH `~/.ssh/config` block generator with auto-deduplication.
- Live Forwarded Port detection with 1-click external browser links.

---

## [4.0.0] - 2026-08-24

### Added
- Bento Grid Cloud Hub webview dashboard with dark/light mode toggle.
- Create Codespace wizard with direct GitHub API repository and branch picker.
- DevContainer Rebuild support (Standard vs Full clean rebuild).
- Permanent sidebar tree actions (Connect, Turn ON, Stop, Open in Web, Delete).
