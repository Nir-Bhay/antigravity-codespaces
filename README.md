<div align="center">

<img src="icon.png" width="120" alt="Antigravity Codespaces Pro — multi-account GitHub Codespaces manager for Cursor IDE, Antigravity IDE, VS Code, and VSCodium" />

# Antigravity Codespaces Pro

### Enterprise Multi-Account GitHub Codespaces Manager for Cursor IDE, Antigravity IDE, VS Code & Code-OSS

**Connect, start, stop, rebuild, test, and monitor every cloud dev environment across all your GitHub accounts — with 1 click.**

[![Version](https://img.shields.io/open-vsx/v/nirbhay-hiwse/antigravity-codespaces?style=for-the-badge&logo=eclipse&color=A855F7&label=Open%20VSX)](https://open-vsx.org/extension/nirbhay-hiwse/antigravity-codespaces)
[![Downloads](https://img.shields.io/open-vsx/dt/nirbhay-hiwse/antigravity-codespaces?style=for-the-badge&color=22C55E&label=Downloads)](https://open-vsx.org/extension/nirbhay-hiwse/antigravity-codespaces)
[![Rating](https://img.shields.io/badge/Rating-★★★★★%20(5.0)-F59E0B?style=for-the-badge)](https://open-vsx.org/extension/nirbhay-hiwse/antigravity-codespaces)
[![Tests](https://img.shields.io/github/actions/workflow/status/Nir-Bhay/antigravity-codespaces/build-and-release.yml?style=for-the-badge&logo=github&label=Tests)](https://github.com/Nir-Bhay/antigravity-codespaces/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

[**Install from Open VSX**](https://open-vsx.org/extension/nirbhay-hiwse/antigravity-codespaces) · [**Download VSIX**](https://github.com/Nir-Bhay/antigravity-codespaces/releases/latest) · [**Report Issue**](https://github.com/Nir-Bhay/antigravity-codespaces/issues) · [**Discussions**](https://github.com/Nir-Bhay/antigravity-codespaces/discussions)

</div>

---

## Why Developers Use This Extension

If you code in **Cursor IDE**, **Google Antigravity IDE**, **Windsurf**, or **VSCodium**, you already know the problem: **Microsoft's official GitHub Codespaces extension is closed-source and restricted only to official Microsoft VS Code.** It is completely absent from the Open VSX Registry.

Without a dedicated extension, connecting your favorite AI editor to GitHub Codespaces is painful:
- You have to copy CLI commands manually from browser tabs.
- You have to hand-craft `~/.ssh/config` blocks and debug missing keys or password prompts.
- When you run long autonomous AI agent sessions (**Cursor Agent**, **Antigravity Agent**, **Claude Code**, or **Aider**), idle SSH tunnels drop and kill your task.
- You cannot easily manage multiple GitHub accounts (work, personal, client orgs) at the same time.

**Antigravity Codespaces Pro is the universal, open solution.** It brings a first-class visual dashboard, keyboard launcher, automated SSH configuration, and multi-account cloud workspace management directly inside Cursor, Antigravity, VS Code, and open-source editors.

---

## Editor Compatibility Matrix

| Editor / Platform | Support Level | How to Install |
|---|:---:|---|
| **Cursor IDE** | Native / Full | Extensions panel (`Ctrl+Shift+X`) → Search **`Antigravity Codespaces Pro`** or **`Codespaces`** |
| **Antigravity IDE** | Native / Full | Extensions panel (`Ctrl+Shift+X`) or 1-click VSIX install |
| **VS Code & Code-OSS** | Full Support | Open VSX Registry or VSIX install |
| **Windsurf & VSCodium** | Native / Full | Search **`Antigravity Codespaces Pro`** on Open VSX |
| **Gitpod Desktop** | Full Support | Install via Open VSX extension view |

---

## Core Capabilities

### ⚡ 1-Click Quick Connect — `Alt+C`
Press `Alt+C` anywhere in your editor. A fuzzy-search launcher lists every Codespace across all your GitHub accounts (running instances prioritized, followed by recent activity). Press Enter, and you are connected inside your editor in seconds.

### 🏢 True Multi-Account Support (Work + Personal + Orgs)
Connect multiple GitHub accounts simultaneously:
- Native GitHub OAuth (fast, no terminal popups).
- Personal Access Tokens (stored encrypted in your OS keychain via `SecretStorage`).
- GitHub CLI (`gh auth`).
Each account is queried in parallel with isolated tokens. Switching accounts never logs out or disturbs other accounts.

### 🤖 AI Agent Session KeepAlive (Cursor Agent & Antigravity Agent)
Autonomous agent tasks often run for 10 to 45 minutes without terminal typing. Standard SSH tunnels drop on idle timeout, killing the agent midway. Antigravity Codespaces Pro automatically configures `ServerAliveInterval` and `TCPKeepAlive` inside SSH host blocks so your agent keeps working uninterrupted until the job is done.

### 🛡️ Zero-Password SSH Tunneling & Golden Blocks
The extension automatically detects GitHub CLI authentication keys (`~/.ssh/codespaces.auto`) and injects proper `IdentityFile` declarations into your SSH configuration. No more unexpected password prompts or broken proxy commands. Writes are atomic with automatic `.bak` backups.

### 🖥️ Bento Grid Cloud Hub Dashboard
Open a full-featured management panel right inside your editor:
- **KPI Metrics Strip:** Total workspaces, running instances, stopped containers, and free storage tier usage.
- **Account Chips:** Filter workspaces by account with a single click.
- **Live Search (`/`):** Instant search by repository name, Codespace display name, or branch.
- **View Switcher:** Toggle between clean Bento Cards and compact List View.
- **4-Step Creation Wizard:** Account → Repository → Branch → Provision with auto-recovery.
- **Container Lifecycle Controls:** Wake up (cold boot), stop, standard rebuild, clean rebuild, and delete.

### 🌐 Live Port Forwarding Discovery & Latency Checker
Inspect forwarded web ports (3000, 5173, 8080, etc.) on running containers directly from the sidebar. Run millisecond latency pings before connecting to pick the fastest cloud region.

---

## Quickstart Guide

### For Cursor IDE Users
1. Open Cursor and press `Ctrl+Shift+X` (or `Cmd+Shift+X` on macOS).
2. Search for **`Antigravity Codespaces Pro`** (or **`Codespaces`**).
3. Click **Install**.
4. Click the Cloud icon in the Activity Bar or press `Alt+C` to connect to your Codespaces instantly.

### For Antigravity IDE & VS Code Users
1. Search **`Antigravity Codespaces Pro`** in the Extensions sidebar.
2. Hit **Install**.
3. Or install manually via CLI:
   ```bash
   antigravity-ide --install-extension antigravity-codespaces-5.0.7.vsix
   ```

### Prerequisites
1. **GitHub CLI (`gh`)** — Used for secure SSH proxying:
   - **Windows:** `winget install --id GitHub.cli`
   - **macOS:** `brew install gh`
   - **Linux:** `sudo apt install gh`
2. Authenticate your account:
   ```bash
   gh auth login -s codespace
   ```
   *(Or click "Sign In with GitHub" inside the extension dashboard).*

---

## Configuration Settings

Customize behavior under `Settings` (`Ctrl+,`) → **Antigravity Codespaces Pro**:

```json
{
  "antigravity-codespaces.autoSyncSSHOnStartup": true,
  "antigravity-codespaces.showStatusBarItem": true,
  "antigravity-codespaces.serverAliveInterval": 30,
  "antigravity-codespaces.serverAliveCountMax": 10,
  "antigravity-codespaces.defaultRemoteFolder": "/workspaces/${repo}"
}
```

| Setting | Default | Description |
|---|:---:|---|
| `autoSyncSSHOnStartup` | `true` | Automatically synchronizes active Codespaces to `~/.ssh/config` on editor startup |
| `showStatusBarItem` | `true` | Displays active Codespaces count in the bottom status bar |
| `serverAliveInterval` | `30` | Interval in seconds for SSH keepalive pings (prevents disconnects) |
| `serverAliveCountMax` | `10` | Maximum missed keepalive pings before considering connection dropped |
| `defaultRemoteFolder` | `/workspaces/${repo}` | Default folder to open on remote connection (`${repo}` or `${name}`) |

---

## Command Palette Reference (`Ctrl+Shift+P` / `Cmd+Shift+P`)

| Command | Shortcut | Description |
|---|:---:|---|
| **Antigravity Codespaces: Quick Connect to Codespace** | `Alt+C` | Fuzzy-search launcher across all accounts |
| **Antigravity Codespaces: Open Cloud Hub Dashboard** | — | Open full grid/list management dashboard |
| **Antigravity Codespaces: Open Quick Actions Menu** | — | Single menu for common account & machine tasks |
| **Antigravity Codespaces: Create New Codespace** | — | Interactive 4-step wizard |
| **Antigravity Codespaces: Switch GitHub Account** | — | Switch between connected accounts |
| **Antigravity Codespaces: Sync SSH Config** | — | Re-generate clean SSH Golden Blocks in `~/.ssh/config` |
| **Antigravity Codespaces: Test SSH Connectivity** | — | Ping tunnel latency in milliseconds |
| **Antigravity Codespaces: Turn ON / Stop** | — | Wake cold container or shut down to save quota |
| **Antigravity Codespaces: Rebuild Container** | — | Standard cached or full clean container rebuild |
| **Antigravity Codespaces: Delete Codespace** | — | Safely remove a Codespace with confirmation |

---

## Feature Comparison

| Feature | Browser GitHub Tab | Official MS Extension | Antigravity Codespaces Pro |
|---|:---:|:---:|:---:|
| **Cursor IDE Support** | ❌ | ❌ (Blocked/Unavailable) | ✅ **First-Class** |
| **Antigravity IDE Support** | ❌ | ❌ (Unavailable) | ✅ **First-Class** |
| **VSCodium / Windsurf Support** | ❌ | ❌ (Unavailable) | ✅ **First-Class** |
| **Open VSX Registry** | ❌ | ❌ (Proprietary) | ✅ **Verified Publisher** |
| **Multi-Account Switching** | ❌ (1 active session) | ⚠️ (Single account) | ✅ **Parallel Multi-Account** |
| **Full Dashboard (Grid/List)** | ❌ | ❌ (Basic tree view) | ✅ **Bento Cloud Hub** |
| **Fast Launcher** | ❌ | ❌ | ✅ **`Alt+C` Quick Connect** |
| **AI Agent KeepAlive** | ❌ | ❌ (Drops on idle) | ✅ **Tuned Ping Engine** |
| **SSH Key Auto-Injection** | ❌ | ❌ | ✅ **Zero-Password Auto Key** |

---

## Architecture & Security

```
┌─────────────────────────────────────────────────────────────┐
│                    LOCAL WORKSTATION                        │
│                                                             │
│   Cursor IDE / Antigravity IDE / VS Code                    │
│   ├── Activity Bar Sidebar & Bento Cloud Hub                │
│   ├── Alt+C Quick Connect Launcher                          │
│   └── Codespaces Pro Engine                                 │
│       ├── AuthManager (OAuth / SecretStorage PATs / CLI)    │
│       ├── GithubApi (REST-first, CLI fallback, TTL cache)   │
│       ├── SSH Golden Block Manager (Atomic writes, backup)  │
│       └── Agent KeepAlive Engine (Ping daemon)              │
│                                                             │
│   ~/.ssh/config ──► ProxyCommand: gh cs ssh -c <name>       │
└──────────────────────────────┬──────────────────────────────┘
                               │  Encrypted TLS Tunnel (Port 443 / 22)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                GITHUB CODESPACES CLOUD VM                   │
│   • DevContainer (Ubuntu/Debian)                            │
│   • SSH Daemon & Remote Server Host                         │
│   • Forwarded App Ports (3000, 5173, 8080)                  │
└─────────────────────────────────────────────────────────────┘
```

- **Credential Security:** Personal access tokens are stored strictly in the operating system's native keychain using the VS Code `SecretStorage` API. Tokens are never written to plain text files.
- **Atomic SSH Writes:** Host configuration writes to `~/.ssh/config` use temporary files and atomic renames, preventing corruptions even during sudden system restarts.
- **Zero Shell Injection:** All external commands use direct argument arrays (`execFile`) without passing through shell interpreters.

---

## Frequently Asked Questions (FAQ)

### Does this work in Cursor IDE?
Yes. Cursor IDE is powered by the Open VSX extension registry. You can install Antigravity Codespaces Pro directly from Cursor's Extensions view. It gives you complete GitHub Codespaces connectivity inside Cursor.

### Why does my SSH connection ask for a password?
GitHub Codespace containers only accept SSH public keys; password authentication is disabled on the container. Antigravity Codespaces Pro automatically configures your `~/.ssh/config` to point to `~/.ssh/codespaces.auto`. If you ever see a password prompt, run `Ctrl+Shift+P` → **Antigravity Codespaces: Sync SSH Config** to refresh your keys.

### Can I connect multiple GitHub accounts?
Yes. You can connect personal accounts, enterprise organizations, and client accounts simultaneously. You can use OAuth for one account, Personal Access Tokens for another, and the GitHub CLI for a third. All accounts appear in the Cloud Hub dashboard with live status indicators.

### How does this help AI Agent workflows?
Tools like Cursor Agent, Antigravity Agent, Claude Code, and Aider frequently perform multi-step planning and long compilation tasks without active keyboard input. Standard SSH connections drop after a few minutes of inactivity. Antigravity Codespaces Pro injects automated keepalive signals (`ServerAliveInterval 30`) to keep the tunnel open continuously.

---

## Deep-Dive Guides & Documentation

Explore dedicated architecture and workflow guides:

- 📖 **[Connecting Cursor IDE to GitHub Codespaces (Step-by-Step)](docs/CURSOR_IDE_CODESPACES_GUIDE.md)** — Complete walkthrough for Cursor users, including Open VSX installation, GitHub CLI auth, and port forwarding.
- 🤖 **[AI Agent KeepAlive & Session Persistence](docs/AI_AGENT_KEEP_ALIVE_GUIDE.md)** — How to prevent idle SSH socket termination during long Cursor Agent and Antigravity Agent runs.
- 🏢 **[Multi-Account GitHub Codespaces Management](docs/MULTI_ACCOUNT_MANAGEMENT.md)** — Isolate personal, employer, and client org tokens with zero credential cross-contamination.

---

## Search & Discovery Keywords

`cursor-codespaces` · `cursor-ide` · `cursor-remote-ssh` · `cursor-agent` · `github-codespaces` · `antigravity-ide` · `antigravity-codespaces` · `remote-development` · `multi-account-github` · `ssh-tunnel` · `devcontainer` · `vscodium` · `windsurf` · `code-oss` · `open-vsx` · `cloud-ide` · `codespace-manager` · `ai-agent-keepalive` · `remote-ssh-codespaces`

---

## Contributing & Support

- 🐛 **Issue Tracker:** [GitHub Issues](https://github.com/Nir-Bhay/antigravity-codespaces/issues)
- 💬 **Discussions:** [GitHub Discussions](https://github.com/Nir-Bhay/antigravity-codespaces/discussions)
- ⭐️ **Star the Repository:** If this extension makes your cloud workflow easier, consider starring the repo on GitHub!

---

## License

MIT License © 2026 [Nirbhay hiwse](https://github.com/Nir-Bhay). Built with pride for developers using modern AI and open-source editors.
