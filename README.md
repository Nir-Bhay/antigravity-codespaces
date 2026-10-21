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

## What's new in 5.1.0

**5.1.0** is the first-run and connect release. SSH into a Codespace still goes through the GitHub CLI, and the extension now checks that path before it opens a window.

- **First-run prerequisites.** Install the `gh` CLI, sign in with `gh auth login`, grant the Codespaces permission with `gh auth refresh -h github.com -s codespace`, and install a Remote-SSH extension.
- **Connect pre-checks.** **Connect**, **Quick Connect to Codespace...**, and **Test SSH Connectivity** stop on four `gh` states — CLI missing, signed out, missing `codespace` scope, wrong account — and offer a one-click fix.
- **Codespaces: Setup Doctor.** One panel checks the CLI, OpenSSH, Remote-SSH, the `codespace` scope, the active account, and `remote.SSH.remotePlatform`. **Copy Diagnostic Report** redacts tokens before they reach the clipboard.
- **Sidebar `gh` status and welcome card.** The Codespaces view shows live `gh` status with a Fix action, and a three-step Get Started card until the CLI is ready.
- **Connect progress and the real folder.** A four-step notification covers the CLI check, SSH config, container wake, and open. The window opens the Codespace's recent folder when GitHub reports one.
- **Connect Now and Reconnect to Last Codespace.** After **Create New Codespace**, choose **Connect Now**. Later, run **Reconnect to Last Codespace**.
- **Host keys and SSH logs.** Generated blocks use `StrictHostKeyChecking accept-new`, an extension-managed `~/.antigravity-codespaces/known_hosts` file, and `LogLevel ERROR`. Change them with `antigravity-codespaces.strictHostKeyChecking` (default `accept-new`) and `antigravity-codespaces.sshLogLevel` (default `error`).

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
   antigravity-ide --install-extension antigravity-codespaces-5.1.0.vsix
   ```

### First-run prerequisites

SSH tunnels use the GitHub CLI. The extension's own sign-in (OAuth or a PAT) powers the dashboard and is not enough on its own. On a new machine, finish these four steps, or open **Codespaces: Setup Doctor** and use the Fix button on any row that fails.

1. **GitHub CLI (`gh`) installed** — Used for secure SSH proxying:
   - **Windows:** `winget install --id GitHub.cli`
   - **macOS:** `brew install gh`
   - **Linux:** `sudo apt install gh`
2. **Signed in to GitHub CLI:**
   ```bash
   gh auth login
   ```
   The in-editor **Run gh auth login** action sends `gh auth login -s codespace`, so the first login asks for the Codespaces scope. You can also use **Login to GitHub Account** for the extension session that fills the sidebar.
3. **`codespace` scope on the CLI token.** If `gh` is already signed in and Connect reports a missing scope, refresh that token:
   ```bash
   gh auth refresh -h github.com -s codespace
   ```
4. **Remote-SSH extension.** Connect opens the Codespace with Remote-SSH (Cursor's Anysphere Remote SSH, Open Remote - SSH, or the VS Code Remote - SSH extension). Setup Doctor searches for one and can open the Extensions view when it is missing.

---

## Connect, Setup Doctor, and the Sidebar

### Connect pre-checks

Before **Connect**, **Quick Connect to Codespace...**, or **Test SSH Connectivity** starts an SSH tunnel, the extension reads `gh auth status`. Each of the four failure states has a one-click fix and a **Connect Anyway** action that continues. Dismissing the signed-out, missing-scope, or wrong-account warning stops the connection.

| `gh` state | What you see | One-click fix |
|---|---|---|
| CLI missing | GitHub CLI is not installed | **Install Instructions** — `winget` on Windows, Homebrew on macOS, or [cli.github.com](https://cli.github.com) |
| Signed out | GitHub CLI is signed out (separate from the extension sign-in) | **Run gh auth login** — opens a terminal with `gh auth login -s codespace` |
| Missing `codespace` scope | Signed in, but SSH would fail with HTTP 403 | **Fix scope now** — opens a terminal with `gh auth refresh -h github.com -s codespace` |
| Wrong account | `gh` user is not the Codespace owner | **Switch gh CLI & Retry** — `gh auth switch --hostname github.com --user <account>`. If that account is not logged into the CLI, the terminal falls back to `gh auth login -h github.com -s codespace` |

The same four states appear on the sidebar `gh` status row, each with a **Fix** button.

### Codespaces: Setup Doctor

Run **Codespaces: Setup Doctor** from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`). The panel checks:

- GitHub CLI installed, signed in, and granted the `codespace` scope
- `gh` account matches the extension account
- OpenSSH client on `PATH`
- A Remote-SSH extension is installed
- `remote.SSH.remotePlatform` is not `windows` on Codespace hosts
- `~/.ssh/config` has no duplicate Codespace host blocks (**Run Sync SSH** calls **Sync SSH Config**)

Failed rows expose the same terminal or Extensions fix as Connect. **Re-run Checks** refreshes the panel.

**Copy Diagnostic Report** copies a shareable report to the clipboard: OS, IDE, extension and `gh` versions, redacted `gh auth status`, the `gh` path, Codespace SSH blocks, the last Doctor results, and the last tunnel error. Tokens are stripped before copy: `gho_`, `ghp_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`, `Bearer` values, and `token:` fields become `[REDACTED]`. Paste that report when you file an issue.

### Sidebar `gh` status and welcome card

The Codespaces sidebar keeps a `gh` status line under the header:

- `gh CLI: @user` when the CLI is signed in with the `codespace` scope
- `gh CLI not installed`, `gh signed out`, `gh needs codespace permission`, or `gh: @user (mismatch)` otherwise, with **Fix**

With no extension account, the view is a welcome card: **Sign In with GitHub**, **Use Personal Access Token (PAT)**, and a system checklist for the GitHub CLI, OpenSSH, and Remote-SSH. After you sign in, a **Get Started** card tracks three steps — sign in to GitHub, set up the GitHub CLI, connect to a Codespace — until `gh` is healthy or you dismiss the card. Dismissal is remembered for this editor profile.

### Connect progress and the real Codespace folder

**Connect** shows a notification with the Codespace name and four steps:

1. **Checking gh CLI** — the pre-checks above.
2. **Configuring SSH** — writes the Golden Block and sets `remote.SSH.remotePlatform` for that host to `linux`.
3. **Waking container** when the machine is stopped, or **Container running** when it is already available.
4. **Verifying remote folder**, then **Opening remote folder**.

The folder is the Codespace's real workspace, in this order:

1. The first path in the Codespace `recentFolders` list.
2. `/workspaces/<repo>` when the Codespace reports a devcontainer path.
3. `antigravity-codespaces.defaultRemoteFolder` (default `/workspaces/${repo}`; `${repo}` and `${name}` are replaced).

If that path is not on the machine, Connect asks you to pick a folder under `/workspaces`, `/workspaces` itself, or a custom absolute path, then opens that folder in a Remote-SSH window.

### Connect Now and Reconnect to Last Codespace

**Create New Codespace** ends with a confirmation that includes **Connect Now**. That button runs **Connect** on the Codespace that was just created.

**Reconnect to Last Codespace** wakes the Codespace you connected to most recently (if it is stopped) and runs **Connect** again. If you have never connected in this editor, it tells you to connect once first.

---

## Configuration Settings

Customize behavior under `Settings` (`Ctrl+,`) → **Antigravity Codespaces Pro**:

```json
{
  "antigravity-codespaces.autoSyncSSHOnStartup": true,
  "antigravity-codespaces.showStatusBarItem": true,
  "antigravity-codespaces.serverAliveInterval": 30,
  "antigravity-codespaces.serverAliveCountMax": 10,
  "antigravity-codespaces.defaultRemoteFolder": "/workspaces/${repo}",
  "antigravity-codespaces.strictHostKeyChecking": "accept-new",
  "antigravity-codespaces.sshLogLevel": "error"
}
```

| Setting | Default | Description |
|---|:---:|---|
| `autoSyncSSHOnStartup` | `true` | Automatically synchronizes active Codespaces to `~/.ssh/config` on editor startup |
| `showStatusBarItem` | `true` | Displays active Codespaces count in the bottom status bar |
| `serverAliveInterval` | `30` | Interval in seconds for SSH keepalive pings (prevents disconnects) |
| `serverAliveCountMax` | `10` | Maximum missed keepalive pings before considering connection dropped |
| `defaultRemoteFolder` | `/workspaces/${repo}` | Default folder to open on remote connection (`${repo}` or `${name}`) |
| `strictHostKeyChecking` | `accept-new` | Host key mode written as `StrictHostKeyChecking`. `accept-new` stores new keys and rejects changes. `yes` only connects to hosts whose key is already saved. `no` skips verification |
| `sshLogLevel` | `error` | SSH verbosity written as `LogLevel`. `error` (default) is `LogLevel ERROR`. Also `quiet`, `info`, and `verbose` |

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
| **Connect** | — | Open a Codespace. From the palette, with no machine selected, this opens Quick Connect |
| **Codespaces: Setup Doctor** | — | First-run and SSH checks with one-click fixes. The panel button **Copy Diagnostic Report** redacts tokens |
| **Reconnect to Last Codespace** | — | Wake and connect to the Codespace you opened last |

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
| **First-Run Checks** | ❌ | ❌ | ✅ **Codespaces: Setup Doctor** |
| **SSH Host Key Checking** | ⚠️ | ⚠️ | ✅ **`accept-new` + managed known_hosts** |

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
- **Host Key Verification (TOFU):** Generated `~/.ssh/config` blocks set `StrictHostKeyChecking accept-new` and `UserKnownHostsFile` to the extension-managed `~/.antigravity-codespaces/known_hosts` file. The first connection stores the key. A later key change is rejected and **Test SSH Connectivity** can remove the stale line. `antigravity-codespaces.strictHostKeyChecking` accepts `accept-new` (default), `yes`, or `no`. The next **Connect** or **Sync SSH Config** rewrites existing Codespace blocks to this policy.
- **SSH Log Level:** Blocks set `LogLevel ERROR` so fatal SSH conditions are visible and routine noise stays quiet. `antigravity-codespaces.sshLogLevel` accepts `quiet`, `error` (default), `info`, or `verbose`. Every `~/.ssh/config` write and every `remote.SSH.remotePlatform` change is also appended, with a timestamp and without tokens, to the **Codespaces** output channel.
- **Transparent Error Handling:** Connection failures surface actionable guidance (`gh` auth status, missing scopes, platform mismatches, host key changes) instead of a raw exit code. See [Troubleshooting](#troubleshooting).

---

## Troubleshooting

### Exit 255 ("nonexistent pipe")

The SSH tunnel closed before a shell started. That is almost always the GitHub CLI, not a dead container: `gh` is signed out, its token lacks the `codespace` scope, or it is signed into a different account than the Codespace owner. Connect tries to catch this in the pre-checks. If the tunnel still exits 255, read the sidebar `gh` line or run **Codespaces: Setup Doctor** and **Test SSH Connectivity**. Then `gh auth login`, or `gh auth refresh -h github.com -s codespace` when a token already exists. Confirm the machine is running (**Turn ON**) and retry **Connect**.

### Exit 127 / `remotePlatform` windows vs linux

Codespaces are Linux. If `remote.SSH.remotePlatform` for the Codespace host is `windows`, Remote-SSH starts PowerShell on the container and the remote command exits 127 (`powershell: command not found`, or a bare exit 127 on a host whose alias starts with `cs.`). **Connect** sets `remote.SSH.remotePlatform["<host>"]` to `"linux"` before it opens the folder. When a host is still wrong, **Codespaces: Setup Doctor** lists it and **Fix setting** writes `linux`. You can also set that host to `linux` under `remote.SSH.remotePlatform` and reconnect.

### Scope errors

`needs the "codespace" scope`, HTTP 403, or "Must have admin rights to Repository" means the token `gh cs ssh` is using does not include `codespace`. The extension sign-in can be valid at the same time. Run:

```bash
gh auth refresh -h github.com -s codespace
```

**Fix scope now** on the Connect warning, **Fix** on the sidebar, and **Grant scope** in Setup Doctor each open a terminal with that command. Finish the device flow, then retry **Connect**. A fine-grained PAT or a `GH_TOKEN` environment variable can hide scope names from `gh auth status`; in that case the pre-check continues and the tunnel error is what tells you to refresh the token.

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
