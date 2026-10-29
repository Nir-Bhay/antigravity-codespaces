# IDE Setup Guide: GitHub Codespaces over SSH in Antigravity, Cursor, VS Code, Windsurf and more

**Antigravity Codespaces** (`nirbhay-hiwse.antigravity-codespaces`) lets you browse, start and connect to **GitHub Codespaces** over SSH from **Google Antigravity**, **Cursor**, **VS Code**, **Windsurf** and other VS Code-based editors. Your editor runs locally and the codespace runs in the cloud. The tunnel is the official GitHub CLI (`gh cs ssh --stdio`, used as an SSH `ProxyCommand`), so you never have to manage SSH keys or open ports. This guide covers installation for each IDE, the Remote-SSH extension each one needs, OS-specific notes and troubleshooting.

> **Choose the version you need:** extension galleries can lag GitHub Releases. Check the version shown by your editor's gallery; if it is older than the release you need, install the `.vsix` from the [latest GitHub release](https://github.com/Nir-Bhay/antigravity-codespaces/releases/latest). A successful install or marketplace listing does not establish end-to-end Remote-SSH compatibility.
> **Requirements:** an editor compatible with VS Code engine `^1.85.0`, the GitHub CLI (`gh`), an OpenSSH client, and a Remote-SSH extension.

> **Prefer to let your AI agent do it?** Paste the prompt from [AGENT_SETUP.md](../AGENT_SETUP.md) into your IDE's agent chat.

---

## 1. Compatibility table

| IDE | Extension marketplace | Install command | Remote-SSH extension | Notes |
|---|---|---|---|---|
| **Google Antigravity** | Open VSX | `antigravity --install-extension nirbhay-hiwse.antigravity-codespaces` | Built-in Antigravity remote support, or `jeanp413.open-remote-ssh` | Microsoft's Remote-SSH is not available. On macOS, the CLI is at `/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity` if it isn't on PATH. |
| **Cursor** | Open VSX, served through Cursor's proxy `marketplace.cursorapi.com` ([Cursor docs](https://cursor.com/help/customization/extensions)) | `cursor --install-extension nirbhay-hiwse.antigravity-codespaces` | `anysphere.remote-ssh` (Cursor's own, bundled) | The extension tries the `anysphere-remote-ssh.*` connect commands first. |
| **VS Code** | Microsoft Marketplace (check its listed version; use GitHub Releases if it is older than the version you need) | `code --install-extension ./antigravity-codespaces-<version>.vsix` | `ms-vscode-remote.remote-ssh` | Verify the downloaded VSIX filename before installing. |
| **VS Code Insiders** | Microsoft Marketplace (check its listed version; use GitHub Releases if it is older than the version you need) | `code-insiders --install-extension ./antigravity-codespaces-<version>.vsix` | `ms-vscode-remote.remote-ssh` | Verify the downloaded VSIX filename before installing. |
| **Windsurf** | Open VSX | `windsurf --install-extension nirbhay-hiwse.antigravity-codespaces` | Windsurf's built-in SSH, `codeium.windsurf-remote-openssh` | Per [Windsurf docs](https://docs.windsurf.com/windsurf/advanced), do **not** install Microsoft Remote-SSH or `open-remote-ssh`; they conflict with the built-in one. It needs OpenSSH installed and supports Linux remotes only. Whether it honors a custom `ProxyCommand` is not documented, so if Quick Connect fails, use **Copy SSH Command**. Extension ID is Community-reported ([issue #324](https://github.com/Exafunction/codeium/issues/324)). |
| **VSCodium** | Open VSX | `codium --install-extension nirbhay-hiwse.antigravity-codespaces` | `jeanp413.open-remote-ssh` | |
| **Trae** | TRAE's own extension store; Marketplace extensions via manual `.vsix` ([TRAE docs](https://docs.trae.ai/ide/manage-extensions)) | **Install from VSIX…**, or `trae --install-extension …` (CLI name Community-reported: [forum.trae.cn](https://forum.trae.cn/t/topic/171618)) | Trae's built-in Remote SSH ([TRAE docs](https://docs.trae.ai/ide/ssh-remote)) | Trae's Remote SSH supports Linux remotes only, which is fine because codespaces run Linux. |
| **Kiro** | Open VSX ([Kiro docs](https://kiro.dev/docs/privacy-and-security/)) | `kiro --install-extension …` (by default `kiro` launches the IDE, [Kiro CLI reference](https://kiro.dev/docs/reference/cli-commands/)) or **Install from VSIX…** | `jeanp413.open-remote-ssh` (Open Remote - SSH from Open VSX, named in [Kiro docs](https://kiro.dev/docs/privacy-and-security/)) | Kiro has no native Remote SSH yet ([kirodotdev/Kiro#3965](https://github.com/kirodotdev/Kiro/issues/3965)); the extension is third-party. |
| **Positron** | Posit P3M (same catalog as Open VSX) or Open VSX directly ([Positron docs](https://positron.posit.co/extensions)) | `positron --install-extension …` (enable via *Install 'positron' command in PATH*, [Positron docs](https://positron.posit.co/add-to-path)) or **Install from VSIX…** | Positron's built-in Remote SSH ([Positron docs](https://positron.posit.co/remote-ssh)) | Linux remotes only. Set `remoteSSH.transport` to `native` if your SSH config needs OpenSSH features such as `ProxyJump`. The gallery is set by `positron.extensions.gallerySource`. |
| **Void** | Microsoft Marketplace gallery URL in `product.json` ([source](https://github.com/voideditor/void/blob/main/product.json)); use **Install from VSIX…** if its gallery does not offer the version you need | `void --install-extension …` (`applicationName: void` in [product.json](https://github.com/voideditor/void/blob/main/product.json)) or **Install from VSIX…** | Bundled Open Remote-SSH fork ([voideditor/void#282](https://github.com/voideditor/void/pull/282)) | Void is deprecated and no longer maintained ([repo](https://github.com/voideditor/void)). Best-effort only. |
| **Eclipse Theia / Gitpod OpenVSCode Server** | Open VSX | n/a | n/a | ❌ Not a target. These are browser or remote IDEs with no local SSH client, so a codespace can't be tunneled into them. Use the codespace's own web editor instead. |

Entries labeled *Community-reported* are not in official docs. Feedback and PRs are welcome.

**Verification status:** CI currently launches a clean VS Code Stable Extension Development Host and checks activation plus selected command handlers. It does not test Remote-SSH or a live Codespace. No editor/provider combination in this table should be treated as end-to-end verified until it has been tested with a named editor and provider version; use the [live smoke-test checklist](LIVE_SMOKE_TEST.md) to record results.

Setup Doctor recognizes these Remote-SSH IDs: `jeanp413.open-remote-ssh`, `ms-vscode-remote.remote-ssh`, `vsx-remote-ssh.vsx-remote-ssh` and `anysphere.remote-ssh`, plus any installed extension whose ID contains `remote-ssh`. If none is found, its one-click fix installs `jeanp413.open-remote-ssh`.

---

## 2. Common steps (every IDE)

### Step 1: Install the GitHub CLI

| OS | Command |
|---|---|
| Windows | `winget install --id GitHub.cli --source winget` |
| macOS | `brew install gh` |
| Debian/Ubuntu | GitHub's official apt repo, see [install_linux.md](https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian). Avoid the distro's community `gh` package (2.45/2.46 are broken per that doc) |
| Fedora | `sudo dnf install gh` (Fedora community package), or GitHub's official RPM repo per [install_linux.md](https://github.com/cli/cli/blob/trunk/docs/install_linux.md#dnf5) |

Check it with `gh --version`. Restart the IDE afterwards so it picks up the new `PATH`.

### Step 2: Sign in with the `codespace` scope

```bash
gh auth login -s codespace
```

If you're already signed in but are missing the scope:

```bash
gh auth refresh -h github.com -s codespace
```

`gh auth status` should list `'codespace'` under **Token scopes**.

*Optional, for usage analytics only:* use **Grant access** on the Usage card when prompted. Native GitHub sign-in requests the additional permission only after you choose it; GitHub CLI accounts run `gh auth refresh -h github.com -s user`, while PAT accounts need the billing permission added in token settings. Declining leaves Codespaces access unchanged.

### Step 3: Install a Remote-SSH extension

Install the one listed for your IDE in the table, for example `<cli> --install-extension jeanp413.open-remote-ssh`.

### Step 4: Install Antigravity Codespaces

- **From the gallery:** search for *Antigravity Codespaces* (Open VSX-based IDEs), or run `<cli> --install-extension nirbhay-hiwse.antigravity-codespaces`.
- **From a .vsix:** download the asset from the [latest release](https://github.com/Nir-Bhay/antigravity-codespaces/releases/latest), confirm its version and filename on the release page, then run `<cli> --install-extension ./<downloaded-file>.vsix`. Alternatively, use **Extensions: Install from VSIX…** in the Command Palette.

### Step 5: Run Setup Doctor

Open the Command Palette and run **Codespaces: Setup Doctor**. It checks `gh`, sign-in, the `codespace` scope, the Remote-SSH extension and `remote.SSH.remotePlatform`, and offers one-click fixes.

### Step 6: Connect

- **Quick Connect to Codespace...** picks a codespace and opens it in a new window.
- Or use the sidebar: **Turn ON** a codespace, then **Connect**.
- **Open Cloud Hub Dashboard** gives an overview with usage analytics.
- Next time, use **Reconnect to Last Codespace**.

The extension writes one marked block per account-and-Codespace pair into `~/.ssh/config` (between `# CS_ENTRY:<account>:<name>` and `# END_CS_ENTRY:<account>:<name>`), with account-qualified host aliases such as `cs.<account>.<codespace-name>`:

```sshconfig
Host cs.<account>.<name> cs-<account>-<owner>-<repo>
  User codespace
  ProxyCommand "<path-to-gh>" cs ssh -c "<name>" --stdio
  StrictHostKeyChecking accept-new
  ServerAliveInterval 30
  ServerAliveCountMax 10
```

Run **Sync SSH Config** to regenerate it. **Test SSH Connectivity** checks the tunnel without opening a window.

---

## 3. Per-IDE notes

### Google Antigravity
1. Install `gh` and run `gh auth login -s codespace`.
2. Open Extensions, search *Antigravity Codespaces* and install it from Open VSX.
3. Run **Codespaces: Setup Doctor**. If it reports no Remote-SSH extension, apply the fix (Open Remote - SSH).
4. Run **Quick Connect to Codespace...**.

### Cursor
1. Install `gh` and sign in as above.
2. Install from Extensions, or run `cursor --install-extension nirbhay-hiwse.antigravity-codespaces`. If search doesn't find it, use the release `.vsix`.
3. Cursor's bundled Remote SSH (`anysphere.remote-ssh`) is used automatically.
4. Run Setup Doctor, then Quick Connect.

For the longer Cursor walkthrough (connection methods, Cursor Agent tips, account switching), see [CURSOR_IDE_CODESPACES_GUIDE.md](CURSOR_IDE_CODESPACES_GUIDE.md).

### VS Code / VS Code Insiders
1. Install `gh` and sign in.
2. Install `ms-vscode-remote.remote-ssh` from the Marketplace.
3. If the Marketplace version is older than the version you need, download the `.vsix` from the [latest GitHub release](https://github.com/Nir-Bhay/antigravity-codespaces/releases/latest), verify its asset name, and run `code --install-extension ./<downloaded-file>.vsix` (use `code-insiders` for Insiders). If `code` isn't on PATH, run **Shell Command: Install 'code' command in PATH** (macOS).
4. Run Setup Doctor, then Quick Connect.

### Windsurf
1. Install `gh` and sign in.
2. Run `windsurf --install-extension nirbhay-hiwse.antigravity-codespaces`, or search Extensions.
3. Use Windsurf's built-in SSH. Don't install `jeanp413.open-remote-ssh` or Microsoft Remote-SSH; [Windsurf docs](https://docs.windsurf.com/windsurf/advanced) say they conflict. Then run Setup Doctor and connect.

### VSCodium
1. Run `codium --install-extension jeanp413.open-remote-ssh`.
2. Run `codium --install-extension nirbhay-hiwse.antigravity-codespaces`.
3. Run Setup Doctor, then Quick Connect.

### Trae, Kiro, Positron, Void
Follow the common steps. If the CLI isn't on PATH, install from the `.vsix` through the Command Palette. Trae and Positron have built-in Remote SSH, Void bundles an Open Remote-SSH fork, and Kiro needs `jeanp413.open-remote-ssh` from Open VSX. Run Setup Doctor first. If the editor can't open a `vscode-remote://ssh-remote+<host>` window, connect manually: use **Copy SSH Command**, or connect to host `cs.<account>.<codespace-name>` from that editor's own Remote/SSH panel.

---

## 4. Operating system notes

**Windows**
- `gh` is located with `where.exe gh`. Restart the IDE after installing it with winget.
- The SSH config is `%USERPROFILE%\.ssh\config`, and it needs the Windows OpenSSH client (`ssh -V`).
- Codespaces always run **Linux**. If Remote-SSH asks for the platform, choose Linux. A stored `"windows"` value causes exit 127 (see below).

**macOS**
- Install `gh` with Homebrew. If the IDE was launched from the Dock before `gh` was installed, restart it.
- Install IDE CLIs from each app's Command Palette (for example, *Shell Command: Install 'cursor' command*).

**Linux**
- Install `gh` from GitHub's apt/dnf repos. Make sure `~/.ssh` is `700` and `~/.ssh/config` is `600`.

### `remote.SSH.remotePlatform`
Remote-SSH extensions use this map to decide the shell for each host. For codespaces it must be `linux`:

```json
"remote.SSH.remotePlatform": {
  "cs.<account>.<codespace-name>": "linux"
}
```

The extension sets this for its host aliases, and Setup Doctor fixes wrong entries automatically.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **exit code 255** / *"The process tried to write to a nonexistent pipe"* | The `gh` tunnel died immediately. Usually you're not signed in, the `codespace` scope is missing, the codespace is stopped, or `gh` isn't on PATH. | Run `gh auth status`, then `gh auth refresh -h github.com -s codespace`. **Turn ON** the codespace. Run **Test SSH Connectivity** and **Setup Doctor**. |
| **exit code 127** / *command not found* | Platform mismatch: Remote-SSH treats the Linux codespace as Windows. | Set `remote.SSH.remotePlatform["cs.<account>.<name>"]` to `"linux"` or delete the entry. Setup Doctor can fix it. |
| *needs the "codespace" scope* / HTTP 403 | The token lacks `codespace`. | `gh auth refresh -h github.com -s codespace` |
| Usage page asks for access | No `user` scope (needed only for billing analytics). | Choose **Grant access**; native sign-in requests it from VS Code, CLI accounts run `gh auth refresh -h github.com -s user`, and PAT accounts need the billing permission in token settings. Then **Codespaces: Refresh Usage** |
| Host key changed warning | The codespace was rebuilt or recreated. | Run **Sync SSH Config** and reconnect. The extension uses its own managed known_hosts file. |
| Wrong account's codespaces shown | Multiple `gh` accounts | **Switch GitHub Account** |
| Connect does nothing | No Remote-SSH extension | Install the one for your IDE (section 1) and re-run Setup Doctor. |

Still stuck? Open an issue at <https://github.com/Nir-Bhay/antigravity-codespaces/issues> and include the Setup Doctor output (remove any personal data).
