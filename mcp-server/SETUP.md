# MCP client setup and safe first run

The MCP server is an **optional, separate Node.js process**. Installing the editor extension does not install or enable it. The server uses the active GitHub CLI (`gh`) account on the machine where the MCP client launches the process; it does not use the extension's sign-in or SecretStorage.

## Requirements

- Node.js 20 or later and npm.
- GitHub CLI installed and signed in to GitHub.com on the same machine as the MCP client, with the `codespace` scope.
- A local checkout with a GitHub.com remote and a checked-out branch for repository-aware commands.
- A Codespace with SSH available for remote command execution. The setup check does not test SSH connectivity.

Check the CLI sign-in and permissions without showing or copying a token:

```sh
gh auth status --hostname github.com
```

If needed, complete sign-in interactively in your own terminal:

```sh
gh auth login -h github.com -s codespace
```

The server strips token-/secret-named variables from the `gh` child environment. Use `gh auth login`; do not configure `GH_TOKEN` as a substitute.

## Install and configure

From a clone of this repository, install the server's isolated dependencies:

```sh
npm ci --prefix mcp-server
```

Configure your MCP client to launch Node with the **absolute** path to `mcp-server/index.mjs`. The snippets below show common stdio configuration shapes; client schemas change and these have **not been integration-tested against a named client/version**. Check your client's current MCP configuration documentation. This project does not claim universal client compatibility.

### VS Code-style `mcp.json` shape (not client/version tested)

```json
{
  "servers": {
    "antigravity-codespaces": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/antigravity-codespaces/mcp-server/index.mjs"]
    }
  }
}
```

### Cursor-style MCP settings shape (not client/version tested)

```json
{
  "mcpServers": {
    "antigravity-codespaces": {
      "command": "node",
      "args": ["/absolute/path/to/antigravity-codespaces/mcp-server/index.mjs"]
    }
  }
}
```

Use the schema and file location currently documented by your chosen client. Keep the process local; do not put tokens or credentials in the configuration. For a non-default Node or `gh` installation, use the absolute executable path (or set `GH_PATH` in the MCP process environment to the `gh` executable path).

## Safe first run

1. Ask the client to call **`check_setup`**. It checks Node.js, `gh` availability, `gh` authentication and the `codespace` scope, plus GitHub repository/branch detection. It does not list, start, or create a Codespace and does not reveal the `gh auth status` output.
2. Resolve any failed check using its remediation text. The check reads local CLI status; it cannot guarantee remote API access, quota availability, SSH readiness, or client interoperability.
3. Before any local-change transfer, call **`preview_local_changes`**. It reports repository, branch, changed file names, untracked file names, patch size, and the 5 MiB limit; it excludes Git-ignored files and never returns patch contents. Review the paths, since non-ignored untracked files can still contain private data.
4. Run commands without sync first where possible. To transfer changes, explicitly set `syncLocalChanges: true` on `run_repository_command` only after reviewing the preview. The local and Codespace HEAD commits must match; the changes are applied in a detached temporary worktree and removed after command completion.

`check_setup` and `preview_local_changes` are read-only with respect to GitHub Codespaces. `run_repository_command` can start or create a Codespace when no exact repository/branch match exists; it stops a Codespace it started or created after the command, on a best-effort basis. Starting/creating can incur compute charges, and stopped Codespaces may continue to incur storage charges. A forced process termination, machine loss, or network/API outage can prevent cleanup. Set a suitable GitHub Codespaces idle timeout and review active Codespaces and billing when using automatic provisioning.

## Output and privacy

The server redacts recognized GitHub tokens, bearer tokens, JWTs, and credential assignments from output, but arbitrary secrets cannot be identified reliably. Do not run commands that print credentials. Logs and forwarded URLs may expose sensitive information; inspect them before sharing. Commands run remotely and can modify files or consume compute.

## Tools and verification

See [README.md](README.md) for every tool, lifecycle behavior, and the verification boundary. Automated tests use mocked GitHub CLI operations and local temporary Git repositories; they do not establish live GitHub API behavior, billing, SSH, or interoperability with a specific MCP client/version. Live verification is opt-in and should use a disposable Codespace with cost consent.
