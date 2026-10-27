# Antigravity Codespaces MCP server

This is an initial stdio MCP server for running a command in an explicitly named GitHub Codespace. It uses the GitHub CLI already installed and authenticated on the computer running the MCP client; the Codespace must already exist and `gh codespace ssh` must be able to reach it.

## Requirements

- Node.js 20 or later
- GitHub CLI (`gh`) authenticated to GitHub.com with the `codespace` scope
- A Codespace with an SSH server available

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

The server speaks MCP over stdio. Protocol messages use stdout; diagnostic output must go to stderr. The `run_codespace_command` tool takes an exact Codespace name, a shell command or script, and an optional timeout. It streams stdout and stderr as MCP progress notifications when the client requests progress, and returns captured output and the remote exit code when the command finishes. A nonzero remote exit is returned as a tool error.

Commands execute remotely and can change files or consume Codespaces compute. The server does not create, start, stop, or delete Codespaces in this milestone, and does not upload local changes. It does not promise zero billing: stopped Codespaces may still incur storage charges. Do not pass secrets in the command or rely on tool output to redact remote data.

## Current verification boundary

The protocol handler and process behavior are covered by local tests with mocked child processes and an in-memory MCP client. No live Codespace was started or created; remote SSH behavior, billing, and IDE/MCP-client interoperability still need an end-to-end test.
