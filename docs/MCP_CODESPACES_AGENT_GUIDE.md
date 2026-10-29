# Run GitHub Codespaces commands from an MCP client

Use the optional Antigravity Codespaces MCP server when an AI coding agent needs to inspect a repository, run a command, or perform a test inside a GitHub Codespace. The server is separate from the editor extension: it runs as a local Node.js stdio process and uses the GitHub CLI identity on the machine where the MCP client starts it.

This guide describes the intended workflow and safety boundaries. For installation and client configuration, see [MCP client setup](../mcp-server/SETUP.md). For exact tool inputs and lifecycle behavior, see the [MCP reference](../mcp-server/README.md).

## Choose the right Codespaces surface

- Use the **editor extension** to browse accounts, inspect Codespaces, and connect an editor over SSH.
- Use the **MCP server** when an agent needs to run a remote command or test. Installing the extension does not install or configure the MCP server.
- Use GitHub's web interface or CLI for tasks the MCP server does not expose. The server intentionally has no Codespace delete tool.

## Before the agent runs a command

1. Install Node.js 20+, GitHub CLI (`gh`), and the MCP server on the computer where the client launches it.
2. Sign in to GitHub CLI on that computer with the `codespace` scope. The MCP identity is separate from the extension's GitHub sign-in.
3. Ask the client to call `check_setup`. This is a local read-only check; it does not list, start, or create a Codespace and cannot prove SSH or API access.
4. Select the exact repository and branch before running work. The server reuses a Codespace only when both match; if no exact match exists, `run_repository_command` may create one.
5. Before transferring local changes, call `preview_local_changes`. Review changed and untracked paths and the transfer size; do not transfer secrets or files you do not intend to share.

## Transfer only the reviewed local snapshot

`preview_local_changes` returns a single-use `previewId`. It expires after 10 minutes. To sync, explicitly set `syncLocalChanges: true` and pass that preview's ID as `localChangesPreviewId` to `run_repository_command`.

The server rejects a stale preview when repository, branch, HEAD, or patch content differs. Only the reviewed patch is applied, in a detached temporary worktree; the local and remote HEAD commits must match. Git-ignored files are excluded, but non-ignored untracked files can be included. The patch limit is 5 MiB. The preview returns file paths and size, not file contents.

If anything changed since preview, generate and inspect a new preview rather than retrying with the old ID.

## Understand command and cleanup behavior

- `run_repository_command` detects the local GitHub repository and branch, then reuses an exact-match Codespace or creates one. It starts a stopped match as needed.
- `run_codespace_command` targets an explicitly named existing Codespace.
- The response includes streamed output and the remote command's exit status. Review output before sharing; the server can redact recognized token patterns but cannot identify arbitrary secrets.
- After a command, the server best-effort stops a Codespace it started or created. It leaves one that was already running untouched. A command failure still attempts cleanup.
- Forced termination, machine loss, or GitHub/network failure can prevent cleanup. This is not a zero-cost guarantee or crash-recovery mechanism.

## Cost and security boundaries

Starting or creating a Codespace can incur compute charges. Stopping it ends compute use but does not remove its storage charges. Review [GitHub Codespaces billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-codespaces/about-billing-for-github-codespaces), the active account's quotas, and idle timeout before a live run.

The server captures the active GitHub.com CLI token once per multi-step operation and pins local GitHub CLI calls, including SSH and cleanup, to that identity. The token remains in process memory; the server does not change global `gh` sign-in. It is not taken from the extension's secret storage, and setting `GH_TOKEN` is not a substitute for completing `gh auth login`.

Commands execute remotely and may modify files. Never ask an agent to print credentials. Review forwarded URLs and command output before sharing them.

## Verification: what tests do and do not prove

The automated MCP suite uses mocked GitHub CLI operations and local temporary repositories. It covers repository/branch matching, reuse/create/start/stop behavior, preview expiry and drift rejection, output, exit codes, and error handling. It does **not** prove live GitHub API behavior, billing, SSH connectivity, or interoperability with a particular MCP client/editor version.

For a carefully scoped real-client check using a disposable Codespace, follow the [live smoke-test checklist](LIVE_SMOKE_TEST.md). Record the exact client and version; one successful client run is not evidence of universal compatibility.

## Common problems

| Symptom | What to check |
|---|---|
| `check_setup` reports no sign-in or scope | On the MCP host, run `gh auth status --hostname github.com`; if needed, complete `gh auth login -h github.com -s codespace`. |
| No matching Codespace exists | Confirm Git remote, repository, and checked-out branch. The repository command may create a Codespace, which can incur charges. |
| Local sync is rejected | The preview expired or the repository, branch, HEAD, or patch changed. Re-run `preview_local_changes`, review it again, and use its new ID. |
| Command output has a failure status | Treat the returned exit code as the result; inspect the sanitized error and verify cleanup status separately. |
| A Codespace may remain running | Check GitHub's current state and billing. Stop only a test-created or otherwise authorized Codespace; do not assume the MCP process can clean up after a forced stop or outage. |
