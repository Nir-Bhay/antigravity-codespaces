# Changelog

All notable changes to the **Antigravity Codespaces Pro** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
