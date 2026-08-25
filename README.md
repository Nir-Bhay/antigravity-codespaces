# Antigravity Codespaces Pro

[![Version](https://img.shields.io/badge/version-4.3.0-blue.svg)](https://github.com/Nir-Bhay/antigravity-codespaces/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-available-purple.svg)](https://open-vsx.org/extension/nirbhay-hiwse/antigravity-codespaces)
[![Platform](https://img.shields.io/badge/platform-Antigravity%20IDE%20%7C%20Code--OSS-blueviolet.svg)](https://github.com/Nir-Bhay/antigravity-codespaces)
[![GitHub Stars](https://img.shields.io/github/stars/Nir-Bhay/antigravity-codespaces?style=social)](https://github.com/Nir-Bhay/antigravity-codespaces/stargazers)

> **Manage every GitHub Codespace across all your accounts — connect, start, stop, rebuild, and monitor — directly inside Antigravity IDE or Code-OSS with one click.**

---

## The Problem This Solves

Standard GitHub Codespaces extensions work only in proprietary Microsoft VS Code builds. If you use **Google Antigravity IDE**, **Gitpod**, **Code-OSS**, or any Open-Source VS Code fork, you get nothing — no sidebar, no connection UI, no SSH management.

**Antigravity Codespaces Pro** fills that gap. It gives you a fully featured, enterprise-grade Codespaces control panel natively inside any Code-OSS compatible editor, with multi-account support and AI agent-optimized connection stability baked in.

---

## Key Features at a Glance

| Feature | What It Does |
|---|---|
| 🖥️ **Bento Cloud Hub Dashboard** | Full-page webview with live cards for every environment across all accounts |
| 🔑 **Multi-Account Architecture** | Query and manage unlimited GitHub accounts with isolated tokens — no global CLI switching |
| ⚡ **Alt+C Quick Connect** | Fuzzy-search and attach to any running Codespace in under 2 seconds |
| 🔗 **SSH Config Auto-Sync** | Writes clean, deduplicated `~/.ssh/config` blocks on startup |
| 🧪 **SSH Latency Tester** | Real-time roundtrip ping to verify tunnel health before connecting |
| 🤖 **AI Agent KeepAlive** | Custom `ServerAliveInterval` prevents WebSocket drops during long AI sessions |
| 🛠️ **DevContainer Lifecycle** | Start, Stop, Rebuild (standard or full clean), Delete — all from the sidebar |
| 🌐 **Port Forwarding View** | Detect and open forwarded ports in one click |
| 📊 **Status Bar Widget** | Live online container count visible at all times in the editor |

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   LOCAL WORKSTATION                  │
│                                                      │
│  ┌─────────────────────┐   ┌──────────────────────┐  │
│  │  Antigravity IDE UI │   │ Codespaces Pro Engine │  │
│  │  • Activity Sidebar │◄──►│ • Token-Isolated API  │  │
│  │  • Cloud Hub Dash   │   │ • SSH Config Writer   │  │
│  │  • Alt+C Launcher   │   │ • KeepAlive Manager   │  │
│  └──────────┬──────────┘   └──────────┬────────────┘  │
│             │                         │               │
│             ▼                         ▼               │
│       ~/.ssh/config  ←──── gh cs ssh ProxyCommand     │
└─────────────────────────────┬────────────────────────┘
                              │  Encrypted SSH Tunnel
                              ▼
┌──────────────────────────────────────────────────────┐
│              GITHUB CODESPACES VM (Cloud)            │
│  • DevContainer  • Remote Extension Host  • Ports    │
└──────────────────────────────────────────────────────┘
```

---

## Installation

### Prerequisites

1. **GitHub CLI** (required for Codespaces API access):
   ```powershell
   winget install --id GitHub.cli
   ```

2. **Antigravity IDE** or any Code-OSS / Open VSX compatible editor.

3. **Remote SSH extension** (recommended): *Open Remote SSH* or *VSX Remote SSH* for automatic remote folder mounting.

### Install the Extension

**Option A — Direct VSIX install (recommended):**
```powershell
# Download the latest release from GitHub
antigravity-ide --install-extension antigravity-codespaces-4.3.0.vsix
```
Or inside the IDE: `Ctrl+Shift+P` → **Extensions: Install from VSIX...** → select the `.vsix` file.

**Option B — Open VSX Registry:**
Search **"Antigravity Codespaces Pro"** in the Extensions panel of any Open VSX compatible editor.

### Authenticate GitHub Account(s)

```bash
# First account
gh auth login -s codespace -w

# Each additional account (repeat for every account you want to manage)
gh auth login -s codespace -w
```

---

## Usage

### Cloud Hub Dashboard

Open the full Bento Grid dashboard from the activity bar sidebar or run:
```
Ctrl+Shift+P → "Open Cloud Hub Dashboard"
```

Each environment card shows:
- **Status** — Active (green pulse) or Inactive
- **Machine specs** — vCPUs, RAM, cloud region
- **Last active** timestamp and current branch
- **Action dock** — Connect, Turn ON/Stop, Test SSH, Rebuild, Copy SSH Command, Open in Browser, Delete

### Quick Connect (Alt+C)

Press `Alt+C` from anywhere in the editor to instantly fuzzy-search across all your Codespaces and attach to one. No mouse required.

### SSH Config Sync

The extension automatically maintains clean `~/.ssh/config` entries on startup. You can also trigger a manual sync:
```
Ctrl+Shift+P → "Sync SSH Config"
```

After syncing, connect from any terminal:
```bash
ssh cs-your-codespace-name
# or
gh cs ssh -c your-codespace-name
```

---

## Configuration

Add these to your `settings.json` to customize behavior:

```json
{
  "antigravity-codespaces.autoSyncSSHOnStartup": true,
  "antigravity-codespaces.showStatusBarItem": true,
  "antigravity-codespaces.serverAliveInterval": 30,
  "antigravity-codespaces.serverAliveCountMax": 10
}
```

| Setting | Default | Description |
|---|---|---|
| `autoSyncSSHOnStartup` | `true` | Sync SSH host blocks on IDE launch |
| `showStatusBarItem` | `true` | Show live Codespace count in status bar |
| `serverAliveInterval` | `30` | SSH keepalive interval in seconds |
| `serverAliveCountMax` | `10` | Max keepalive probes before disconnect |

---

## Command Reference

All commands are available via `Ctrl+Shift+P`:

| Command | Shortcut | Description |
|---|---|---|
| `Codespaces: Quick Connect` | `Alt+C` | Fuzzy-search and connect to any Codespace |
| `Codespaces: Open Cloud Hub Dashboard` | — | Full-page visual management dashboard |
| `Codespaces: Open Quick Actions Menu` | — | Switch account, sync SSH, test, dashboard |
| `Codespaces: Sync SSH Config` | — | Write all Codespace hosts to `~/.ssh/config` |
| `Codespaces: Test SSH Connectivity` | — | Ping and verify tunnel health |
| `Codespaces: Switch GitHub Account` | — | Change active GitHub account |
| `Codespaces: Create New Codespace` | — | Wizard with repo and branch picker |
| `Codespaces: Turn ON` | — | Wake a stopped Codespace |
| `Codespaces: Stop` | — | Stop container to save billable hours |
| `Codespaces: Rebuild Container` | — | Standard or full clean DevContainer rebuild |
| `Codespaces: Delete Codespace` | — | Confirmation-gated permanent deletion |

---

## Optimizing Your DevContainer for Antigravity IDE

Add the OpenSSH feature to your `.devcontainer/devcontainer.json` for best compatibility:

```json
{
  "name": "My Project",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu-24.04",
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": { "version": "latest" }
  }
}
```

---

## Troubleshooting

**Initial connection takes 30-40 seconds**
This is normal on cold boot — GitHub is spinning up the container. Once connected, everything is instant.

**`gh: command not found`**
Ensure GitHub CLI is installed and `C:\Program Files\GitHub CLI` is in your `PATH`. Restart the IDE after installing.

**WebSocket disconnects during AI agent sessions**
Increase `serverAliveInterval` in settings. The default of `30` seconds should be sufficient for most networks; increase to `60` on unstable connections.

**SSH host not found after sync**
Run `Ctrl+Shift+P` → **Sync SSH Config** manually, then check `~/.ssh/config` contains a `Host cs-<name>` block for your Codespace.

---

## Roadmap

- [ ] Windows Notification toasts on Codespace status changes
- [ ] Org-level Codespace billing summary widget
- [ ] Direct devcontainer feature installer from the dashboard
- [ ] VS Code Marketplace submission (tracking: [#1](https://github.com/Nir-Bhay/antigravity-codespaces/issues))

---

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and pull request process.

Found a bug? Open an issue → [github.com/Nir-Bhay/antigravity-codespaces/issues](https://github.com/Nir-Bhay/antigravity-codespaces/issues)

---

## License

MIT License — see [LICENSE](LICENSE)

**Author:** [Nirbhay hiwse](https://github.com/Nir-Bhay) • [GitHub Repository](https://github.com/Nir-Bhay/antigravity-codespaces)
