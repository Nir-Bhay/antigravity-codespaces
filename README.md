<div align="center">

<img src="icon.png" width="120" alt="Antigravity Codespaces Pro — multi-account GitHub Codespaces manager for Cursor IDE, Antigravity IDE, VS Code, and VSCodium" />

# Antigravity Codespaces Pro

### Manage GitHub Codespaces from VS Code-based editors and coding agents

Browse and connect to GitHub Codespaces over SSH, manage their lifecycle, and review GitHub-reported usage from Antigravity, Cursor, Windsurf, and VS Code-based editors. For coding agents, an optional separate Model Context Protocol (MCP) server can run remote commands. Editor compatibility and live service behavior depend on your setup; see the [compatibility notes](docs/IDE_SETUP.md) and [verification boundaries](#support-and-verification-boundaries).

[![Version](https://img.shields.io/open-vsx/v/nirbhay-hiwse/antigravity-codespaces?style=for-the-badge&logo=eclipse&color=A855F7&label=Open%20VSX)](https://open-vsx.org/extension/nirbhay-hiwse/antigravity-codespaces)
[![Downloads](https://img.shields.io/open-vsx/dt/nirbhay-hiwse/antigravity-codespaces?style=for-the-badge&color=22C55E&label=Downloads)](https://open-vsx.org/extension/nirbhay-hiwse/antigravity-codespaces)
[![Tests](https://img.shields.io/github/actions/workflow/status/Nir-Bhay/antigravity-codespaces/build-and-release.yml?style=for-the-badge&logo=github&label=Tests)](https://github.com/Nir-Bhay/antigravity-codespaces/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

[**Install from Open VSX**](https://open-vsx.org/extension/nirbhay-hiwse/antigravity-codespaces) · [**Download VSIX**](https://github.com/Nir-Bhay/antigravity-codespaces/releases/latest) · [**Report Issue**](https://github.com/Nir-Bhay/antigravity-codespaces/issues) · [**Discussions**](https://github.com/Nir-Bhay/antigravity-codespaces/discussions)

</div>

---

## Start here

- **Install and connect from an editor:** follow the [Quickstart](#quickstart-guide), then use the [sidebar and Setup Doctor guide](#connect-setup-doctor-and-the-sidebar).
- **Understand quota data:** read [Usage analytics](#usage-analytics) for permissions, freshness, and reported-vs-derived values.
- **Run commands from an AI agent:** the optional MCP server is **separate** from the editor extension. Start with the [Codespaces MCP workflow guide](docs/MCP_CODESPACES_AGENT_GUIDE.md), then follow the [MCP client setup guide](mcp-server/SETUP.md). The [MCP reference](mcp-server/README.md) lists tools and limits. It runs as a Node.js stdio process and uses the active `gh` account, not extension sign-in.
- **Check editor support:** see the [compatibility matrix](#editor-compatibility) and [IDE-specific setup guide](docs/IDE_SETUP.md); marketplace availability does not prove end-to-end behavior.

### Pick the surface for your task

| What you want to do | Where to start | What it uses |
|---|---|---|
| Browse, create, start, stop, or connect to a Codespace | **Codespaces** activity-bar icon and sidebar; use **Open Cloud Hub Dashboard** for the full view | Extension sign-in for account browsing; GitHub CLI and compatible Remote-SSH for SSH actions |
| Jump to a known workspace | **Quick Connect to Codespace...** or `Alt+C` | Available Codespaces across the accounts configured in the extension |
| Diagnose first-run SSH/editor setup | **Codespaces: Setup Doctor** from the Command Palette | Local `gh`, OpenSSH, Remote-SSH provider, scopes, and editor settings |
| Review quota and billing usage | Cloud Hub **Usage** page or the sidebar usage line; read the [Codespaces cost guide](docs/CODESPACES_COST_GUIDE.md) | GitHub billing API; data updates hourly and optional `user` permission may be requested |
| Run remote commands from an AI agent | Follow the [Codespaces MCP workflow guide](docs/MCP_CODESPACES_AGENT_GUIDE.md) and [client setup](mcp-server/SETUP.md) | Node.js 20+, active `gh` CLI account, and Codespaces access; provisioning may incur charges |

The extension and MCP server are related but do **not** share sign-in state: installing the extension does not configure an MCP client, and MCP uses the CLI account on the machine running the server.

## Release status

The latest **installable** version is shown on [GitHub Releases](https://github.com/Nir-Bhay/antigravity-codespaces/releases/latest) and the [Open VSX listing](https://open-vsx.org/extension/nirbhay-hiwse/antigravity-codespaces). A successful CI build or VSIX artifact is not a publication. Changes documented as **Unreleased** in the [changelog](CHANGELOG.md) are not necessarily present in either registry; check the exact release version before installing.

For the full version history, see the [changelog](CHANGELOG.md). Use the [Codespaces cost guide](docs/CODESPACES_COST_GUIDE.md) for compute/storage billing and lifecycle effects, and the [MCP workflow guide](docs/MCP_CODESPACES_AGENT_GUIDE.md) for remote agent commands and safe local-change sync.

---

## What this project does

Antigravity Codespaces Pro is an open-source editor extension for managing GitHub Codespaces from VS Code-based editors. It combines a sidebar and dashboard with SSH setup helpers, multi-account browsing, lifecycle actions, and Codespaces billing-usage views. A separate Node.js MCP server is available for coding agents that need to run commands inside a Codespace.

It is intended to reduce repetitive setup and account switching—not to replace GitHub's Codespaces service, the GitHub CLI, or your editor's Remote-SSH implementation. Connection behavior depends on the host editor and its installed Remote-SSH support; see the [compatibility notes](docs/IDE_SETUP.md) and [MCP setup and limitations](mcp-server/README.md).

---

## Editor compatibility

The extension targets the VS Code extension API (`^1.85.0`) and is distributed through Open VSX and GitHub release VSIX assets. Compatibility of installation and Remote-SSH integration varies by editor and version; marketplace availability alone does not guarantee that the host's remote-window APIs behave identically.

| Editor | Distribution / connection notes |
|---|---|
| Cursor | Open VSX / VSIX; uses Cursor's Remote-SSH integration when available. |
| Google Antigravity | Open VSX / VSIX; use Setup Doctor to check remote support. |
| VS Code and Code-OSS forks | Open VSX or VSIX; install a compatible Remote-SSH extension for your host. |
| Windsurf, VSCodium, and other forks | See the editor-specific notes; support depends on each host's remote extension and command APIs. |

The project does not claim that every listed fork/version has been validated end-to-end. Check the [IDE setup guide](docs/IDE_SETUP.md) for known marketplace differences and caveats, and the [agent setup prompt](AGENT_SETUP.md) for guided onboarding.

---

## Core capabilities

### Quick Connect for GitHub Codespaces (`Alt+C`)
Use the Quick Connect command or `Alt+C` to search the Codespaces available to the accounts connected in the extension and choose one to open through your editor's Remote-SSH integration. Startup time and compatibility depend on GitHub, the Codespace state, and the editor's remote support.

### Multi-account Codespaces browsing
The extension can browse Codespaces across multiple accounts configured in its account picker. Extension sign-in is separate from the active `gh` CLI account used for SSH and the optional MCP server; switching one does not silently switch the other. See [account and authentication details](docs/MULTI_ACCOUNT_MANAGEMENT.md).

### SSH configuration for remote development
The extension manages marked Codespaces entries in `~/.ssh/config` and can set configurable `ServerAliveInterval` and `ServerAliveCountMax` keepalive values. These may reduce idle tunnel disconnects, but cannot guarantee that a network, editor, or remote agent session stays connected indefinitely. Host-key verification defaults to `accept-new`; see [SSH security details](#architecture--security).

### Cloud Hub and Codespaces lifecycle
Use the in-editor Cloud Hub to browse, filter, create, start, stop, rebuild, or remove Codespaces with target-specific confirmation. Status and machine details come from GitHub and may be unavailable or transitional; the extension avoids treating an unknown or transitioning state as stopped. Starting uses compute; stopped Codespaces can still use storage. Review the [Codespaces cost guide](docs/CODESPACES_COST_GUIDE.md) and GitHub billing before lifecycle actions.

### SSH diagnostics and forwarded ports
Setup Doctor checks local prerequisites and `Test SSH Connectivity` measures a tunnel probe for a selected Codespace. The sidebar and Cloud Hub can display forwarded port information returned by GitHub. A successful probe or listed port is not a guarantee that every editor can open the remote window or service.

---

## Quickstart Guide

### For Cursor IDE Users
1. Open Cursor and press `Ctrl+Shift+X` (or `Cmd+Shift+X` on macOS).
2. Search for **`Antigravity Codespaces Pro`** (or **`Codespaces`**).
3. Click **Install**.
4. Open the Codespaces view or press `Alt+C` to search for and connect to an available Codespace.

### For other compatible editors
1. Search for **Antigravity Codespaces Pro** in the editor's extension view, or download the latest `.vsix` from [GitHub Releases](https://github.com/Nir-Bhay/antigravity-codespaces/releases/latest).
2. Install the VSIX using the editor's **Install from VSIX** command or its documented CLI.
3. Follow the editor-specific [IDE setup guide](docs/IDE_SETUP.md); marketplace catalogs and Remote-SSH support vary by host.

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

The Codespaces sidebar keeps a `gh` status line under the header. The **Need help or using an AI client?** disclosure is available alongside the account and Codespaces list: it distinguishes extension sign-in (browse/account data) from the active GitHub CLI account (SSH and optional MCP), and links directly to Setup Doctor, Cloud Hub, and the standalone MCP setup guide. Use the same links from the signed-out/install card where relevant; the MCP server remains an optional, separately configured Node.js process.

The status line shows:

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

The Command Palette **Create New Codespace** flow ends with a confirmation that includes **Connect Now**. The Cloud Hub creation wizard instead shows a success toast and closes; connect from the refreshed Codespace card.

**Reconnect to Last Codespace** verifies the saved account-scoped target and its current state. If stopped, it asks for the normal start confirmation before waking it, then runs **Connect** again. If you have never connected in this editor, it tells you to connect once first.

---

## Usage analytics

The Cloud Hub dashboard and the sidebar show how much of your monthly Codespaces quota the **active `gh` account** has used. That's the account `gh auth status` marks as active. The panel follows `gh auth switch`, and the selected account chip in Cloud Hub doesn't change it.

**What's shown**

| Where | What |
|---|---|
| Cloud Hub card | `USAGE · <login> · <plan>`, a **Compute** bar (`76.5 / 180 core-hrs ($6.88 of $16.20)`), a **Storage** bar (`7.6 / 20 GB-month ($0.53 of $1.40)`), hours left, days left, reset date, and a billing line (`$7.42 consumed · −$7.42 included discount · $0.00 billable`) |
| Storage Tier card | Real storage used, for example `7.6 / 20 GB-month` |
| Usage page (left rail) | Tiles (used, remaining, avg/day, days left, storage, reset), a daily core-hours chart with an ideal-pace line, and a sortable per-repository table |
| Sidebar | One line: plan, a thin bar, `x / y core-hrs · ~N days left`. Click it to open the Usage page |

Bars turn orange at 75% and red at 90%. Compute and storage are **separate quotas** and aren't interchangeable, so they're never added together.

**Included quotas (personal accounts)**

| Plan | Compute | Storage |
|---|---|---|
| GitHub Free | 120 core-hours / month ($10.80 value) | 15 GB-month ($1.05) |
| GitHub Pro | 180 core-hours / month ($16.20 value) | 20 GB-month ($1.40) |

Core-hours = cores × hours, so a 2-core machine uses 2 core-hours per hour. Dollar values use GitHub's rates of $0.09 per core-hour and $0.07 per GB-month. Codespaces billed to an organization show as **Billed to {org}** and don't count toward your quota. The plan is detected from your account; override it with `antigravity-codespaces.usage.plan`.

**Where the numbers come from**

Numbers come from GitHub's billing API: `GET /users/{user}/settings/billing/usage/summary` and `.../settings/billing/usage`. They match [github.com/settings/billing](https://github.com/settings/billing). GitHub updates this data **hourly**. The extension caches it for 10 minutes; **Refresh usage** fetches it again. If the network drops, the last good numbers stay with an `offline · last fetched DD Mon YYYY, HH:MM UTC` note.

**Permission**

Core GitHub sign-in requests only the `repo` and `codespace` scopes. Billing analytics may also need the **`user`** scope (or the fine-grained token's **Plan: read** permission). No broader native OAuth permission is requested at sign-in. If billing access is missing, the card shows **Usage needs permission** with a **Grant access** action: native GitHub sign-in asks VS Code for the additional scope only after that click; GitHub CLI accounts open `gh auth refresh -h github.com -s user`; PAT accounts get token-settings guidance. Declining does not affect Codespaces access.

Any other failure shows **Usage unavailable** with the reason. This includes an account not on GitHub's enhanced billing platform, or a machine type this version doesn't recognise. The extension never shows estimated or guessed figures.

---

## Optional MCP server for coding agents

The repository also contains a standalone Node.js stdio MCP server. It is separate from the editor extension and authenticates through the active GitHub CLI account on the machine running the MCP process; it does not reuse the extension's SecretStorage sign-in.

The server can run commands in a named existing Codespace, or detect the current local GitHub repository and branch, then reuse, start, or create an exact-match Codespace for a command. It also exposes list/status/start/stop/log/port tools. There is deliberately no delete tool. Start with the [Codespaces MCP workflow guide](docs/MCP_CODESPACES_AGENT_GUIDE.md), then use the [MCP setup guide](mcp-server/SETUP.md) for configuration and the [MCP server reference](mcp-server/README.md) for the full tool list and limits.

**Review these effects before enabling it:** starting or creating a Codespace can incur compute charges; a stopped Codespace can continue to incur storage charges. Repository local-change sync is opt-in and may send staged/unstaged tracked files plus non-ignored untracked files (up to 5 MiB) to a temporary remote worktree. First review `preview_local_changes`; its ID is single-use, expires after 10 minutes, and sync is rejected if the repository context or patch changes. Inspect `git status` before approving. The server redacts common credential patterns from output, but cannot reliably identify arbitrary secrets; do not run commands that print secrets. Automated tests use mocked GitHub CLI operations, so live API, billing, SSH, and client interoperability still need a controlled manual test.

### Run tests locally

```bash
npm ci --ignore-scripts
npm ci --prefix mcp-server
npm test                          # Extension and MCP unit tests
npm run check                     # Extension syntax check
npm run test:extension-host       # VS Code host activation smoke test
node --check mcp-server/index.mjs
```

On headless Linux, run the host test with `xvfb-run -a npm run test:extension-host`. It downloads and launches a clean VS Code stable host; it does not test live GitHub/Codespaces behavior or other editors. The MCP server requires Node.js 20 or later. For first-run GitHub CLI setup, see [Quickstart](#quickstart-guide) and [IDE setup](docs/IDE_SETUP.md).

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
  "antigravity-codespaces.sshLogLevel": "error",
  "antigravity-codespaces.usage.plan": "auto",
  "antigravity-codespaces.usage.monthlyCoreHours": 120,
  "antigravity-codespaces.usage.monthlyStorageGb": 15
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
| `usage.plan` | `auto` | Plan for the usage quota: `auto` (from your GitHub account), `free` (120 core-hrs / 15 GB-month), `pro` (180 / 20), or `custom` |
| `usage.monthlyCoreHours` | `120` | Included core-hours when `usage.plan` is `custom` |
| `usage.monthlyStorageGb` | `15` | Included GB-month when `usage.plan` is `custom` |

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
| **Antigravity Codespaces: Test SSH Connectivity** | — | Probe the selected SSH tunnel and report latency |
| **Antigravity Codespaces: Turn ON / Stop** | — | Wake cold container or shut down to save quota |
| **Antigravity Codespaces: Rebuild Container** | — | Standard cached or full clean container rebuild |
| **Antigravity Codespaces: Delete Codespace** | — | Safely remove a Codespace with confirmation |
| **Connect** | — | Open a Codespace. From the palette, with no machine selected, this opens Quick Connect |
| **Codespaces: Setup Doctor** | — | First-run and SSH checks with one-click fixes. The panel button **Copy Diagnostic Report** redacts tokens |
| **Reconnect to Last Codespace** | — | Wake and connect to the Codespace you opened last |
| **Codespaces: Refresh Usage** | — | Re-fetch usage from the GitHub billing API |
| **Codespaces: Grant Usage Access (user permission)** | — | Request the usage-only permission for the active authentication method |

---

## Support and verification boundaries

Supported behavior depends on the editor, its Remote-SSH implementation, GitHub CLI authentication, and GitHub account permissions. This repository has automated tests for extension utilities and MCP server behavior, but those tests do not establish compatibility with every editor or prove live GitHub API/Codespaces behavior. The current MCP suite uses mocked GitHub CLI operations; a live Codespace should only be tested in an account/repository where the operator accepts possible compute and continuing storage charges.

For feature scope and known limitations, see [MCP server documentation](mcp-server/README.md), [release notes](CHANGELOG.md), and [release process](docs/releasing.md).

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
The extension is available through Open VSX, which Cursor can use for extensions. Install it from the Extensions view or a VSIX, then check Setup Doctor and the [IDE compatibility notes](docs/IDE_SETUP.md). Remote-SSH behavior depends on the Cursor version and its bundled SSH integration; gallery availability alone is not proof of end-to-end support.

### Why does my SSH connection ask for a password?
GitHub Codespaces SSH is mediated by the GitHub CLI. The extension manages a marked SSH host block and uses `gh cs ssh --stdio`; it adds an `IdentityFile` only when the relevant local file exists. If you see an authentication prompt, check `gh auth status` and Setup Doctor first, then verify the generated `~/.ssh/config` entry.

### Can I browse multiple GitHub accounts?
The extension supports multiple accounts in its account picker, subject to the authentication method and permissions configured for each one. SSH uses the active GitHub CLI account, which is separate from the extension's account selection. The optional MCP server also uses the active `gh` account on the machine that launches it.

### How does this support AI-agent workflows?
The extension can configure SSH keepalive settings that may reduce idle disconnects while an editor agent works in a remote Codespace; this is best-effort, not a guarantee against network or editor timeouts. For an MCP client that needs to run commands in Codespaces, follow the separate [MCP workflow guide](docs/MCP_CODESPACES_AGENT_GUIDE.md) and review the [cost guide](docs/CODESPACES_COST_GUIDE.md) before opting into local-change sync.

---

## Guides and project direction

- [IDE setup guide](docs/IDE_SETUP.md) — editor-specific installation, Remote-SSH requirements, and verification limits.
- [Codespaces MCP workflow guide](docs/MCP_CODESPACES_AGENT_GUIDE.md) — agent command workflow, identity, reviewed sync, cleanup, and cost boundaries.
- [MCP setup guide](mcp-server/SETUP.md) — client configuration examples, read-only preflight, safe sync preview, and first-run steps.
- [MCP server reference](mcp-server/README.md) — tools, local-change sync, security, cost, and verification boundaries.
- [Codespaces billing and lifecycle guide](docs/CODESPACES_COST_GUIDE.md) — compute versus storage, usage freshness, and safer lifecycle decisions.
- [Live smoke-test checklist](docs/LIVE_SMOKE_TEST.md) — opt-in verification with a disposable Codespace and exact client versions.
- [Marketplace copy proposal](docs/MARKETPLACE_COPY.md) — accurate listing text and the external-publishing checklist.
- [Agent setup prompt](AGENT_SETUP.md) — guided setup checklist for an IDE agent.
- [Cursor walkthrough](docs/CURSOR_IDE_CODESPACES_GUIDE.md) — Cursor-focused connection guidance.
- [KeepAlive guide](docs/AI_AGENT_KEEP_ALIVE_GUIDE.md) — SSH keepalive behavior and configuration.
- [Multi-account guide](docs/MULTI_ACCOUNT_MANAGEMENT.md) — account setup and switching.
- [Roadmap and improvement ideas](docs/ROADMAP_MULTI_IDE_AND_IDEAS.md) — prioritized opportunities, dependencies, and acceptance signals. Current UX and safety work: [sidebar onboarding](https://github.com/Nir-Bhay/antigravity-codespaces/issues/56), [cost/lifecycle safety](https://github.com/Nir-Bhay/antigravity-codespaces/issues/55), and [MCP setup/operability](https://github.com/Nir-Bhay/antigravity-codespaces/issues/54).
- [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Releasing](docs/releasing.md)



---

## Contributing & Support

- 🐛 **Issue Tracker:** [GitHub Issues](https://github.com/Nir-Bhay/antigravity-codespaces/issues)
- 💬 **Discussions:** [GitHub Discussions](https://github.com/Nir-Bhay/antigravity-codespaces/discussions)
- ⭐️ **Star the Repository:** If this extension makes your cloud workflow easier, consider starring the repo on GitHub!

---

## License

MIT. See [LICENSE](LICENSE) for the full terms.
