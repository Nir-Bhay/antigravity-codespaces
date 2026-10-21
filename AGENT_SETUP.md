# Agent Setup: let your IDE's AI agent configure GitHub Codespaces over SSH

Copy one prompt into the AI agent in **Antigravity**, **Cursor**, **VS Code** (Copilot agent mode), **Windsurf**, Codex or Claude Code, and it sets up **Antigravity Codespaces** for you. The agent detects your OS and editor, installs the GitHub CLI, checks that you're signed in with the `codespace` scope, installs the extension (from Open VSX or the latest GitHub release `.vsix`) and the right Remote-SSH extension, and lists your **GitHub Codespaces** so you can connect. Every step is safe to re-run. The agent never asks for or handles your tokens. You do the browser sign-in yourself.

See [docs/IDE_SETUP.md](docs/IDE_SETUP.md) for the manual guide.

---

## The prompt (copy everything inside the block)

````text
You are setting up the "Antigravity Codespaces" extension (id: nirbhay-hiwse.antigravity-codespaces)
so that I can connect to my GitHub Codespaces over SSH from this IDE.
Repo: https://github.com/Nir-Bhay/antigravity-codespaces
Work step by step, show each command before running it, and make every step idempotent
(check first, act only if needed). Stop and report if anything fails twice.

SAFETY RULES (must follow):
- NEVER ask me to paste a token, password or OTP into chat, and never print, read or copy
  tokens (no `gh auth token`, no reading ~/.config/gh/hosts.yml or keychains).
- Any login happens in MY terminal/browser: tell me the exact command and wait for me to confirm.
- Ask before anything destructive or hard to undo: deleting/stopping/rebuilding codespaces,
  uninstalling extensions, overwriting ~/.ssh/config, or changing gh accounts.
  Only append/edit; back up ~/.ssh/config (copy to ~/.ssh/config.bak-<date>) before any edit.
- Do not use sudo without telling me why first.

STEP 1 - Detect environment
- OS and arch (Windows: `$PSVersionTable`/`[Environment]::OSVersion`; macOS/Linux: `uname -sm`).
- Which IDE CLI exists, in this order: antigravity, cursor, code, code-insiders, windsurf,
  codium, trae, kiro, positron, void (`command -v <name>` or `where.exe <name>` on Windows).
  macOS fallback paths: /Applications/<App>.app/Contents/Resources/app/bin/<cli>.
  Pick the CLI matching the IDE I'm in now; if unsure, ask me. Call it $IDE_CLI.
- Note the marketplace: VS Code / VS Code Insiders = Microsoft Marketplace (this extension is
  listed there only at the older v4.3.0, so install the 5.3.1 .vsix); Trae and Void = install the 5.3.1 .vsix; all others = Open VSX or an Open VSX mirror.

STEP 2 - GitHub CLI
- Run `gh --version`. If missing, install it:
  Windows: `winget install --id GitHub.cli --source winget` | macOS: `brew install gh` |
  Debian/Ubuntu: GitHub's official apt repo (https://github.com/cli/cli/blob/trunk/docs/install_linux.md) |
  Fedora: `sudo dnf install gh`.
- Re-check `gh --version` (on Windows a new terminal may be needed for PATH).

STEP 3 - Authentication (human does the login)
- Run `gh auth status`.
- If not logged in: tell me to run `gh auth login -s codespace` in my own terminal and finish
  the browser flow. Wait for me to say "done".
- If logged in but "Token scopes" does not include 'codespace': tell me to run
  `gh auth refresh -h github.com -s codespace` and wait.
- Re-run `gh auth status` and confirm 'codespace' is listed. (Fine-grained/PAT setups may not show
  scopes; then proceed and rely on step 7.)
- The 'user' scope is ONLY needed for usage analytics; mention it as optional
  (`gh auth refresh -h github.com -s user`), do not require it.

STEP 4 - Remote-SSH extension
- List extensions: `$IDE_CLI --list-extensions`.
- Required one by IDE:
  VS Code / Insiders -> ms-vscode-remote.remote-ssh
  Cursor -> anysphere.remote-ssh (bundled; do not install another)
  Windsurf -> codeium.windsurf-remote-openssh (built-in; do NOT install open-remote-ssh or
    Microsoft Remote-SSH, they conflict)
  Trae, Positron, Void -> built-in / bundled Remote SSH; install nothing
  Antigravity -> built-in remote support if present; otherwise jeanp413.open-remote-ssh
  VSCodium, Kiro -> jeanp413.open-remote-ssh
- Skip this step for Windsurf, Trae, Positron and Void. For the rest, if no extension id containing "remote-ssh" is installed, run
  `$IDE_CLI --install-extension <id>`.

STEP 5 - Install Antigravity Codespaces
- If `nirbhay-hiwse.antigravity-codespaces` is already in --list-extensions, report its version and skip.
- Otherwise, for Open VSX IDEs: `$IDE_CLI --install-extension nirbhay-hiwse.antigravity-codespaces`.
- If that fails, or for VS Code / Insiders: download the .vsix asset from
  https://github.com/Nir-Bhay/antigravity-codespaces/releases/latest
  (e.g. `gh release download --repo Nir-Bhay/antigravity-codespaces --pattern "*.vsix" --dir <tmp>`)
  and run `$IDE_CLI --install-extension <tmp>/antigravity-codespaces-<version>.vsix`.
- Confirm with `$IDE_CLI --list-extensions --show-versions`.

STEP 6 - remote.SSH.remotePlatform
- Codespaces are always Linux. In the IDE's user settings.json, if "remote.SSH.remotePlatform"
  has any entry for a codespace host (cs.<name>, cs-<account>-<repo>, or a codespace name) whose value
  is not "linux", tell me and, after I agree, set it to "linux". Don't touch other hosts.
  (The extension's "Codespaces: Setup Doctor" can also fix this.)

STEP 7 - List codespaces
- Run `gh cs list`. Report name, repository, state. If empty, tell me I can create one with the
  "Create New Codespace" command or `gh cs create` (ask before creating anything; it may cost money).
- Optional smoke test, only if one is Available and I agree: `gh cs ssh -c <name> -- echo ok`.

STEP 8 - Report back
Give me a short summary with: OS, IDE + CLI used, gh version, gh account + whether 'codespace'
scope is present, Remote-SSH extension id, Antigravity Codespaces version, any settings changed,
the codespace list, and anything that failed. Then tell me to reload the window and run:
"Codespaces: Setup Doctor" -> "Quick Connect to Codespace..." (later: "Reconnect to Last Codespace").
````

---

## Verification checklist

- [ ] `gh --version` prints a version.
- [ ] `gh auth status` shows you're logged in, and **Token scopes** include `codespace`.
- [ ] `<ide-cli> --list-extensions` includes `nirbhay-hiwse.antigravity-codespaces`.
- [ ] A Remote-SSH extension is installed (an ID containing `remote-ssh`).
- [ ] No codespace host in `remote.SSH.remotePlatform` is set to anything other than `linux`.
- [ ] `gh cs list` shows your codespaces.
- [ ] **Codespaces: Setup Doctor** shows all checks green.
- [ ] **Quick Connect to Codespace...** opens a remote window under `/workspaces/<repo>`.
- [ ] *(Optional)* Usage analytics work after **Codespaces: Grant Usage Access (gh user scope)**.

## Why the agent never touches your token
The extension relies entirely on the GitHub CLI's own sign-in, and SSH goes through `gh cs ssh --stdio`. Your credentials stay in the GitHub CLI's secure storage, so neither the agent nor this prompt needs to see them.
