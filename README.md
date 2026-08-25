# Antigravity Codespaces Pro

[![Version](https://img.shields.io/badge/version-4.3.0-blue.svg)](https://github.com/Nir-Bhay/antigravity-codespaces)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Antigravity%20IDE%20%7C%20Code--OSS-purple.svg)](https://github.com/Nir-Bhay/antigravity-codespaces)
[![Author](https://img.shields.io/badge/author-Nirbhay%20hiwse-orange.svg)](https://github.com/Nir-Bhay)

**Antigravity Codespaces Pro** is an enterprise-grade, multi-account GitHub Codespaces manager purpose-built for **Google Antigravity IDE** and Open VSX / Code-OSS environments. It bridges the gap between local AI coding workflows and cloud-hosted developer environments with 1-click connections, automated SSH proxy tunneling, lifecycle controls, and a Bento Grid visual management dashboard.

Developed and maintained by **Nirbhay hiwse**.

---

## 🚀 Key Highlights & What It Solves

* **Native-Like Codespaces in Antigravity IDE:** Standard GitHub Codespaces extensions are restricted to proprietary Microsoft VS Code builds. Antigravity Codespaces Pro brings full remote VM development, devcontainer lifecycle controls, and port forwarding to Antigravity IDE.
* **Token-Isolated Multi-Account Architecture:** Seamlessly manage environments across multiple GitHub personal, organizational, and team accounts simultaneously without global CLI account switching or session clashing.
* **Persistent AI Agent WebSockets:** Injects custom `ServerAliveInterval` and `TCPKeepAlive` parameters to guarantee zero socket disconnects or freezes when Antigravity AI agents run long autonomous sessions.
* **Instant 1-Click Connect (`Alt+C`):** Fuzzy search and attach to any remote Codespace VM directly from the keyboard or status bar.
* **Rich Bento Grid Cloud Hub:** Dedicated full-window webview dashboard with dark/light mode, live search filters, hardware resource specs, and devcontainer rebuild controls.

---

## 🏗️ Architecture & Connection Pipeline

Antigravity Codespaces Pro establishes a secure, zero-friction bridge between your local Antigravity IDE and remote cloud containers:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               LOCAL WORKSTATION                                       │
│                                                                                        │
│   ┌───────────────────────────┐          ┌─────────────────────────────────────────┐   │
│   │   Antigravity IDE UI      │          │   Antigravity Codespaces Pro            │   │
│   │   • Activity Bar Sidebar  │ ◄──────► │   • Token-Isolated Engine (GH_TOKEN)    │   │
│   │   • Bento Cloud Hub Dash  │          │   • Status Bar Widget                   │   │
│   │   • Quick Connect (Alt+C) │          │   • SSH Config Sanitizer                │   │
│   └─────────────┬─────────────┘          └────────────────────┬────────────────────┘   │
│                 │                                             │                        │
│                 ▼                                             ▼                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │                           OpenSSH Client (~/.ssh/config)                       │   │
│   │   • Host: cs.<name> cs-<account>-<repo>                                        │   │
│   │   • ProxyCommand: gh cs ssh -c <name> --stdio -i ~/.ssh/codespaces.auto        │   │
│   │   • ServerAliveInterval: 30s | TCPKeepAlive: yes                               │   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
└───────────────────────────────────────────┼────────────────────────────────────────────┘
                                            │ Encrypted WebRTC / SSH Proxy Tunnel
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              GITHUB CODESPACES VM (Cloud)                              │
│                                                                                        │
│   ┌───────────────────────────┐          ┌─────────────────────────────────────────┐   │
│   │   Remote DevContainer     │          │   Antigravity Remote Extension Host     │   │
│   │   • Workspace Repository  │ ◄──────► │   • antigravity-ide-server (port 41607) │   │
│   │   • Forwarded Ports       │          │   • Language Servers & Terminal Host    │   │
│   │   • Docker / Toolchains   │          │   • AI Agent Worker Process             │   │
│   └───────────────────────────┘          └─────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 💎 Features Walkthrough

### 1. Multi-Account Management & Zero Token Collisions
* Auto-discovers all authenticated accounts from the GitHub CLI keyring (`baythe19`, `Nir-Bhay`, `abhayhiwse-hub`, `teamwebstarts-cmyk`, etc.).
* Queries each account independently using cached OAuth Bearer Tokens (`GH_TOKEN`).
* No global CLI account hopping—your active local git credentials remain untouched while the extension inspects all accounts in parallel.

### 2. Cloud Hub Bento Dashboard (`antigravity-codespaces.openDashboard`)
* High-performance visual management console with glassmorphism design.
* **Top Metric Banner:** Real-time counts of Total Environments, Online Instances, Inactive Storage, and Connected Accounts.
* **Multi-Account Tabs:** Switch between individual account views or browse all workspaces simultaneously.
* **Live Search & Filter:** Instant keyboard filtering by repository name, branch, machine type, or status.
* **Interactive Bento Cards:**
  * Status radar indicator (Active Green pulse vs Inactive Slate).
  * Hardware details (vCPUs, RAM, Cloud Region).
  * Last active timestamp and git branch.
  * Inline action dock: **Connect**, **Turn ON / Stop**, **Test SSH**, **DevContainer Rebuild**, **Copy SSH Command**, **Open in GitHub**, **Delete**.

### 3. One-Click Quick Connect (`Alt+C`) & Status Bar
* Press `Alt+C` from anywhere in the IDE to open the fuzzy-search Quick Connect launcher.
* Bottom Status Bar widget displaying live online container counts (e.g. `$(cloud) Codespaces (1 Online)`).
* Clicking the Status Bar item launches the **Quick Actions Menu** for immediate switching, sync, and dashboard access.

### 4. DevContainer Lifecycle & Port Management
* **New Codespace Wizard:** Fetches user repositories directly from GitHub API into an interactive QuickPick dropdown with branch selection.
* **DevContainer Rebuilding:** Choose between **Standard Rebuild** (layer-cached) or **Clean Full Rebuild** (no cache) without leaving the IDE.
* **Port Discovery:** Scans forwarded ports on running containers and provides direct browser links (`http://localhost:<port>`).

### 5. Automated SSH Config Engine & Latency Tester
* Automatically maintains clean, deduplicated `Host` blocks in `~/.ssh/config` for native OpenSSH, external terminals, and VS Code remote plugins.
* **Built-in Latency Tester:** Measure real-time roundtrip ping to any active Codespace VM (`antigravity-codespaces.testSSH`).

---

## 📦 Installation & Setup

### Prerequisites
1. **GitHub CLI (`gh`)** installed and available on system `PATH`:
   ```powershell
   winget install --id GitHub.cli
   ```
2. **Antigravity IDE** (or Code-OSS fork).
3. **Open-Remote-SSH** or **VSX-Remote-SSH** extension (recommended for automatic remote folder attachment).

### Step 1: Authenticate Your GitHub Account(s)
Log in with Codespace permissions:
```bash
# Primary account
gh auth login -s codespace -w

# Additional accounts (run for each account you want to connect)
gh auth login -s codespace -w
```

### Step 2: Install Extension (VSIX)
```powershell
antigravity-ide --install-extension antigravity-codespaces-4.3.0.vsix
```
*Or inside Antigravity IDE:* Press `Ctrl+Shift+P` → Select **`Extensions: Install from VSIX...`** → Pick `antigravity-codespaces-4.3.0.vsix`.

---

## ⌨️ Command Palette Reference

All commands are prefixed with `Codespaces:` in the Command Palette (`Ctrl+Shift+P`):

| Command Identifier | Title | Shortcut | Description |
| :--- | :--- | :--- | :--- |
| `antigravity-codespaces.quickConnect` | **Quick Connect to Codespace...** | `Alt+C` | Fuzzy-search running & recent codespaces to attach immediately |
| `antigravity-codespaces.quickMenu` | **Open Quick Actions Menu** | — | Launcher for Switch Account, Sync SSH, Test, and Dashboard |
| `antigravity-codespaces.openDashboard` | **Open Cloud Hub Dashboard** | — | Opens full-page Bento Grid webview |
| `antigravity-codespaces.refresh` | **Refresh** | — | Re-queries all connected accounts and updates Status Bar |
| `antigravity-codespaces.switchAccount` | **Switch GitHub Account** | — | Select default active GitHub account |
| `antigravity-codespaces.createCodespace`| **Create New Codespace** | — | Multi-step wizard with repo & branch selection |
| `antigravity-codespaces.syncAllSSH` | **Sync SSH Config** | — | Writes all Codespace host definitions to `~/.ssh/config` |
| `antigravity-codespaces.testSSH` | **Test SSH Connectivity** | — | Tests proxy tunnel health and measures ping latency in ms |
| `antigravity-codespaces.start` | **Turn ON** | — | Wakes up a stopped Codespace container |
| `antigravity-codespaces.stop` | **Stop** | — | Shuts down container to conserve GitHub billable core-hours |
| `antigravity-codespaces.rebuild` | **Rebuild Container** | — | Triggers Standard or Clean Full DevContainer rebuild |
| `antigravity-codespaces.deleteCodespace`| **Delete Codespace** | — | Confirmation-gated permanent VM deletion |
| `antigravity-codespaces.copySSHCommand` | **Copy SSH Command** | — | Copies `gh cs ssh -c <name>` to system clipboard |
| `antigravity-codespaces.openInBrowser` | **Open in Browser** | — | Opens Codespace in GitHub Web editor |

---

## ⚙️ Configuration Settings

Customize behavior in your `settings.json`:

```json
{
  // Automatically sync Codespace SSH host entries on IDE boot
  "antigravity-codespaces.autoSyncSSHOnStartup": true,

  // Display status badge in bottom Status Bar
  "antigravity-codespaces.showStatusBarItem": true,

  // KeepAlive interval in seconds (prevents WebSocket disconnects during AI sessions)
  "antigravity-codespaces.serverAliveInterval": 30,

  // Maximum KeepAlive retry probes before timeout
  "antigravity-codespaces.serverAliveCountMax": 10
}
```

---

## 🛠️ Optimizing Your Codespaces for Antigravity IDE

For best performance when connecting Antigravity IDE to your remote devcontainers, add the OpenSSH feature to your repository's `.devcontainer/devcontainer.json`:

```json
{
  "name": "My Project Container",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu-24.04",
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": {
      "version": "latest"
    }
  },
  "customizations": {
    "vscode": {
      "settings": {
        "terminal.integrated.defaultProfile.linux": "bash"
      }
    }
  }
}
```

---

## 🔍 Troubleshooting Guide

### 1. Initial Handshake Takes ~30-40 Seconds
* **Cause:** When waking an idle Codespace, GitHub spins up the container and initializes the `gh` proxy tunnel.
* **Solution:** This is normal during initial cold boot. Once established, all subsequent IDE operations, terminal commands, and file edits are instantaneous.

### 2. "gh not found" Error
* Ensure GitHub CLI is installed and directory `C:\Program Files\GitHub CLI` is in your Windows `PATH` environment variable. Restart the IDE after installing.

### 3. Agent Panel / WebSocket Reconnection
* If your local internet reconnects, press `Ctrl+Shift+P` → **`Developer: Reload Window`**, then click **`+` (New Chat)** in the Agent panel. The keepalive configuration will maintain the tunnel.

### 4. Direct Terminal SSH Fallback
You can also connect to any synchronized codespace from PowerShell or Bash directly:
```bash
ssh cs-baythe19-samyoj
# or
gh cs ssh -c reimagined-fortnight-4j5p7x95xqqgc6p5
```

---

## 📄 License & Credits

* **Author:** [Nirbhay hiwse](https://github.com/Nir-Bhay)
* **License:** MIT License — see [LICENSE](LICENSE)
