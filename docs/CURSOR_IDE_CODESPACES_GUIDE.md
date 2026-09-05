# Complete Guide: Connecting Cursor IDE to GitHub Codespaces (2026 Edition)

> **Goal:** Run your cloud devcontainers inside **Cursor IDE** with full multi-account management, zero password prompts, and persistent SSH tunnels for **Cursor Agent**.

---

## 1. The Situation with Cursor IDE & Codespaces

Cursor is an AI-first code editor built as a fork of VS Code. However, there is a fundamental difference in how extensions are distributed:

1. **Cursor uses the Open VSX Registry** by default, rather than Microsoft's proprietary Visual Studio Marketplace.
2. **Microsoft's official GitHub Codespaces extension is closed-source and proprietary.** It is licensed solely for official Microsoft VS Code builds and is completely unavailable on Open VSX.
3. Because of this restriction, Cursor developers searching for a native way to manage and launch Codespaces had to rely on manual terminal commands, broken SSH configs, or third-party wrappers that crash on multi-account logins.

**Antigravity Codespaces Pro** bridges this gap directly. It delivers a native UI, Bento Grid dashboard, fuzzy-search launcher, and automatic SSH tunneling built specifically for Open VSX and modern AI editors.

---

## 2. Step-by-Step Setup in Cursor IDE

### Step 1: Install Antigravity Codespaces Pro from Open VSX
1. Open Cursor IDE.
2. Press `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (macOS) to open the **Extensions** panel.
3. Search for:
   ```
   Antigravity Codespaces Pro
   ```
   *(Or simply search `Codespaces`)*
4. Click **Install**.

Alternatively, install via the Cursor terminal:
```bash
cursor --install-extension nirbhay-hiwse.antigravity-codespaces
```

### Step 2: Ensure GitHub CLI (`gh`) is Installed
The extension uses the official GitHub CLI to establish secure SSH proxy tunnels without exposing private keys.

- **Windows:**
  ```powershell
  winget install --id GitHub.cli
  ```
- **macOS:**
  ```bash
  brew install gh
  ```
- **Linux (Debian/Ubuntu):**
  ```bash
  sudo apt update && sudo apt install gh
  ```

### Step 3: Authenticate GitHub CLI
Run:
```bash
gh auth login -s codespace
```
Make sure to request the `codespace` scope during authentication. If you already logged in previously without this scope, refresh it:
```bash
gh auth refresh -h github.com -s codespace
```

---

## 3. Connecting to a Codespace in Cursor

You have three fast ways to connect:

### Method A: Quick Connect Launcher (`Alt+C`) — Fastest
1. Press `Alt+C` anywhere inside Cursor.
2. A fuzzy-search menu displays all your available Codespaces across all authenticated GitHub accounts.
3. Select your desired Codespace and press **Enter**.
4. Cursor connects directly to the remote container in a dedicated window.

### Method B: Activity Bar Sidebar
1. Click the **Cloud** icon in Cursor's Activity Bar (left sidebar).
2. Browse your Codespaces with real-time status indicators (Online vs. Stopped), active branch, and forwarded ports.
3. Click the **Connect** button on any container card.

### Method C: Cloud Hub Bento Dashboard
1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Type and select: `Antigravity Codespaces: Open Cloud Hub Dashboard`.
3. View your full Bento Grid with KPI counters, storage tier indicators, account filters, and container lifecycle actions (Start, Stop, Rebuild, Delete).

---

## 4. Supercharging Cursor Agent on Codespaces

Running **Cursor Agent** inside a remote GitHub Codespace offers major advantages over local development:
- **Zero Local Resource Drain:** Heavy indexing, multi-file code generation, and test suites run entirely on high-spec cloud vCPUs and RAM.
- **Pre-configured Environments:** Devcontainers already have Node.js, Python, Docker, databases, and dependencies installed via `devcontainer.json`.
- **Persistent AI Agent Tunnels:** Autonomous agents often run for 10 to 30 minutes without keyboard interaction. Antigravity Codespaces Pro injects automated keepalive signals (`ServerAliveInterval 30`, `TCPKeepAlive yes`) so your SSH connection never drops midway through an autonomous agent plan.

---

## 5. Troubleshooting Common Cursor Issues

### Q: Why does SSH ask for a password when connecting?
GitHub Codespace containers only support SSH key authentication; password login is disabled. Antigravity Codespaces Pro automatically maps `IdentityFile ~/.ssh/codespaces.auto`. If you see a password prompt:
1. Open Cursor's Command Palette (`Ctrl+Shift+P`).
2. Run **`Antigravity Codespaces: Sync SSH Config`**.
3. Reconnect.

### Q: How do I switch between personal and work GitHub accounts?
Click the account dropdown in the sidebar or run `Antigravity Codespaces: Switch GitHub Account`. Each account's tokens are isolated in your OS keychain via VS Code `SecretStorage`.

---

## Summary
With **Antigravity Codespaces Pro**, Cursor IDE gains seamless, multi-account, persistent cloud development capabilities. Install it today from Open VSX and code anywhere.
