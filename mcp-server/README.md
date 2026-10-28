# Antigravity Codespaces MCP server

This is a standalone Node 20 stdio MCP server for remote commands in GitHub Codespaces. It uses the active GitHub CLI account's persisted sign-in (it does not read the extension host's VS Code SecretStorage). The server strips token-, secret-, password-, credential-, and private-key-named variables from the `gh` child environment, so complete `gh auth login` rather than relying on a `GH_TOKEN` environment variable. It redacts recognized GitHub-token, bearer-token, JWT, and credential-assignment patterns from command output before streaming or returning it; arbitrary secrets cannot be identified reliably, so do not run commands that print them.

## Requirements and setup

For copyable client configuration, the read-only first-run checks, and the safe sync-preview workflow, see the [MCP client setup guide](SETUP.md). Configuration examples are explicitly marked as not integration-tested against a named client/version.

- Node.js 20 or later
- GitHub CLI (`gh`) installed and authenticated to GitHub.com with the `codespace` scope
- A Codespace with an SSH server available for remote command execution

Install the server's isolated dependencies once:

```sh
npm ci --prefix mcp-server
```

Configure an MCP client to launch `node` with the absolute path to `mcp-server/index.mjs`. For example, Cursor-style configuration is:

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

The server uses MCP over stdio. Protocol messages use stdout; diagnostics must go to stderr.

## Tools

- `run_repository_command` detects the local repository from its GitHub remote and current branch. It reuses a Codespace only when both repository and branch match; if none matches, it creates one. A stopped match is started and waited on. After a command completes—including a command failure—the server attempts to stop a Codespace it created or started; it leaves a Codespace that was already running untouched to avoid interrupting existing work. If cleanup fails, the response includes a warning. This is best-effort cleanup, not crash recovery: forced termination (`SIGKILL`), machine loss, or a network/API outage can prevent the stop request from reaching GitHub and leave compute running. Configure GitHub Codespaces' idle timeout and review active Codespaces/billing when using automatic provisioning. Concurrent MCP server processes serialize creation for the same repository/branch.
- Set `syncLocalChanges: true` to transfer staged/unstaged tracked changes and non-ignored untracked files (up to 5 MiB) into a detached temporary Git worktree in the Codespace. The local and remote HEAD commits must match. The temporary worktree is removed after the command, so remote file changes are not retained.
- `run_codespace_command` runs a shell command or script in an explicitly named, existing Codespace.
- `list_codespaces`, `get_codespace_status`, `start_codespace`, `stop_codespace`, `get_codespace_logs`, and `get_codespace_ports` expose basic lifecycle and status operations. There is intentionally no delete tool.
- GitHub CLI failures are sanitized, with actionable messages for API rate limits, Codespaces quota or billing limits, and Codespace start failures.

Commands execute remotely and can change files or consume Codespaces compute. Creating or starting a Codespace can incur compute charges; stopping it ends compute usage but does not remove storage charges. The server does not promise zero cost. Local-change sync is opt-in because untracked files may contain private data; ignored files are excluded. It refuses to patch when the local and remote HEAD commits differ. Logs and forwarded URLs may contain sensitive information; review them before sharing.

## Verification boundary

Local tests cover repository/branch detection, exact-match reuse, start/create/stop behavior with mocked GitHub CLI calls, cross-process creation locking, local patch generation/application, streamed output, timeouts, and exit codes. The stdio server is exercised with the MCP client SDK. No live Codespace was started or created, so remote SSH, actual API behavior, billing, and IDE/MCP-client interoperability remain unverified. Android/emulator feasibility and remote setup/log inspection beyond the current CLI tools are not claimed.
