# Managing Multi-Account GitHub Codespaces in Cursor, Antigravity & VS Code

> **Scenario:** You have a personal GitHub account (`octocat-personal`), a corporate employer account (`octocat-corp`), and client organization accounts. Managing separate Codespaces across these accounts usually requires constant logouts, browser tab juggling, or broken SSH credentials.

---

## 1. The Multi-Account Problem in Cloud Development

Most developer tooling assumes a single active GitHub identity. 

When you juggle multiple accounts:
- GitHub CLI (`gh`) only has one "active" user at a time per hostname.
- VS Code's built-in GitHub extension ties itself to a single login session.
- SSH configurations frequently overwrite each other or attempt the wrong private keys, resulting in cryptic `404 Not Found` or `Permission Denied` errors.

---

## 2. The Solution: Token-Isolated Architecture

**Antigravity Codespaces Pro** is engineered from the ground up as a **multi-account native** director.

### How It Works:
1. **Parallel Account Discovery**: When you open your editor, the extension queries all registered accounts simultaneously.
2. **Encrypted Keyring Storage**: Personal Access Tokens (PATs) and OAuth tokens are stored in your operating system's native keychain using the VS Code `SecretStorage` API (`context.secrets`). Tokens are encrypted at rest with per-account namespace isolation.
3. **No Collision on Active Switching**: Switching the active account changes the focal point in the UI, but background polling and machine statuses for other accounts remain untouched.
4. **Auto-Switching GitHub CLI Proxy**: When you connect to a Codespace owned by Account B while your local GitHub CLI is logged in as Account A, the extension detects the account boundary and prompts you to switch the CLI user automatically via `gh auth switch`.

---

## 3. Supported Authentication Methods

You can mix and match authentication strategies across your accounts:

| Auth Method | Best For | Storage Security |
|---|---|---|
| **Native GitHub OAuth** | Primary accounts | In-memory session, refreshed via GitHub OAuth |
| **Personal Access Token (PAT)** | Work, secondary, or fine-grained scoped accounts | OS Keychain (Windows Credential Manager, macOS Keychain, Linux SecretService) |
| **GitHub CLI (`gh auth`)** | Developers who already use `gh` terminal workflows | Read-only discovery from `~/.config/gh/hosts.yml` |

---

## 4. How to Add and Switch Accounts

### Adding a New Account:
1. Open the sidebar (Cloud icon) or press `Alt+C` → select **Open Cloud Hub Dashboard**.
2. Click the **Accounts** tab or click the Account dropdown.
3. Choose either:
   - **Sign In with GitHub** (OAuth browser flow).
   - **Add Personal Access Token (PAT)** (enter your `ghp_` or `github_pat_` token with `codespace` scope).

### Switching Active Account:
- Press `Ctrl+Shift+P` → **Antigravity Codespaces: Switch GitHub Account**.
- Pick any connected account from the quick pick menu.
- The sidebar, dashboard, and status bar badge immediately adapt to the selected identity.

---

## 5. Security & Isolation Guarantees

- **Zero Disk Credential Dumping**: OAuth tokens and PATs are never written to plain text files, logs, or workspace settings.
- **Strict Host Aliasing**: Each Codespace gets a unique, collision-proof host alias in `~/.ssh/config`:
  ```ssh
  Host cs.<codespace-name> cs-<account>-<owner>-<repo>
  ```
  This guarantees that OpenSSH connects to the exact container intended without cross-account contamination.

---

## Summary
Antigravity Codespaces Pro frees you from account switching friction, giving you a centralized cloud control center across all your professional and personal GitHub identities.
