# Connect Cursor to GitHub Codespaces over SSH

Use Antigravity Codespaces Pro to browse GitHub Codespaces and open a selected workspace from Cursor through SSH. The extension uses Cursor's available Remote-SSH integration; exact behavior depends on the Cursor release and installed provider. This guide avoids assuming that marketplace availability proves connection compatibility.

For setup across other editors, see the [multi-IDE setup guide](IDE_SETUP.md). To run a remote command from an AI client rather than open an SSH workspace, use the separate [Codespaces MCP workflow guide](MCP_CODESPACES_AGENT_GUIDE.md).

## Requirements

- Cursor installed on your local computer.
- GitHub CLI (`gh`) and OpenSSH available on that computer.
- The `codespace` scope on the active GitHub CLI account.
- Cursor's Remote-SSH provider available in your Cursor version.
- Antigravity Codespaces Pro installed from Cursor's extension view or as a VSIX.

Check the installed version in Cursor's Extensions panel. If the gallery is behind, verify the exact version and asset name on [GitHub Releases](https://github.com/Nir-Bhay/antigravity-codespaces/releases/latest) before installing a VSIX.

## 1. Sign in to GitHub CLI

The editor extension's GitHub sign-in and GitHub CLI sign-in are separate. The CLI identity is used for the SSH proxy and optional MCP server.

```bash
gh auth status --hostname github.com
```

If needed, sign in and grant Codespaces access:

```bash
gh auth login -h github.com -s codespace
```

For an existing CLI session missing that permission:

```bash
gh auth refresh -h github.com -s codespace
```

Do not paste or share CLI token output. Confirm that the active CLI account owns or can access the intended Codespace.

## 2. Install the extension and SSH provider

1. Open Cursor's Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
2. Search for **Antigravity Codespaces Pro** and install it, or install the verified VSIX through Cursor's **Install from VSIX** command.
3. Confirm a compatible Remote-SSH provider is available. Cursor commonly bundles `anysphere.remote-ssh`; provider availability and command APIs vary by release.
4. Reload Cursor after installation if the Codespaces view is not visible.

## 3. Run Setup Doctor and connect

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Run **Codespaces: Setup Doctor** and address missing CLI, OpenSSH, scope, or Remote-SSH checks.
3. Use the Codespaces activity-bar view or run **Quick Connect to Codespace...** (`Alt+C`).
4. Confirm the account and Codespace target, then connect. The extension checks status and SSH prerequisites before opening a remote window.
5. If Cursor cannot open the remote window, use **Copy SSH Command** or the Remote-SSH provider's host picker and follow its current guidance.

A successful list or SSH probe does not prove the provider can open every remote window. Record the exact Cursor and Remote-SSH versions when reporting a failure.

## 4. Use Cursor with a remote Codespace

When Cursor is connected to a Codespace, files and terminal commands use the remote environment. This can move some work off the local machine, but local editor processes and network traffic still use local resources. Available CPU, memory, disk, and preinstalled tools depend on the selected Codespace machine and devcontainer.

The extension's SSH keepalive settings may reduce disconnects during idle periods. They are best-effort and cannot guarantee a tunnel will remain connected through network, server, or editor failures. See the [keepalive guide](AI_AGENT_KEEP_ALIVE_GUIDE.md) for details and tradeoffs.

## 5. Optional MCP command workflow

The MCP server is not part of the extension install. It is a separate Node.js process started by an MCP-capable client, and it uses the CLI identity on the computer that launches the process. Follow the [MCP setup guide](../mcp-server/SETUP.md) and [agent workflow guide](MCP_CODESPACES_AGENT_GUIDE.md). Review any local-change preview before opting into sync; provisioning can incur charges.

## Troubleshooting

| Symptom | Next check |
|---|---|
| Extension does not appear | Reload Cursor and verify the installed extension version in the Extensions panel. If the gallery lacks the version needed, use the versioned GitHub Release VSIX. |
| Setup Doctor says CLI is missing | Install GitHub CLI for your OS, restart Cursor, and run Setup Doctor again. |
| CLI account or permission mismatch | Run `gh auth status --hostname github.com`; switch or refresh the CLI sign-in for the intended Codespace. |
| Remote window does not open | Confirm a Remote-SSH provider is available in this Cursor version, rerun Setup Doctor, then try **Copy SSH Command**. |
| Host key changed warning | Refresh SSH config and verify the Codespace was intentionally rebuilt or recreated before accepting a new key. |
| Usage is unavailable | Usage uses GitHub's billing API and may require the optional `user` permission; core Codespaces access is separate. See the [cost guide](CODESPACES_COST_GUIDE.md). |

## Verification boundary

The repository's automated Extension Development Host smoke test checks activation and selected commands in VS Code Stable only; it does not exercise Cursor or SSH. Cursor installation and end-to-end connection should be marked **not verified** until tested with a named Cursor version and Remote-SSH provider. Use the [live smoke-test checklist](LIVE_SMOKE_TEST.md) to record evidence without claiming universal support.
