# Live Codespaces and MCP smoke-test checklist

This is an opt-in manual acceptance check. Automated unit tests and the VS Code Extension Development Host smoke test do not create Codespaces or prove live GitHub, SSH, billing, editor, or MCP-client behavior.

A live test can incur compute and storage charges. Use a disposable repository and Codespace, a small machine, and an account where you can verify billing. Do not use a production workspace or local changes containing secrets. Obtain cost approval from the account owner before creating or starting a Codespace.

## Record the test context

- Date and tester:
- OS and architecture:
- Editor name and exact version:
- Antigravity Codespaces extension version and install source:
- Remote-SSH provider/version:
- MCP client name and exact version (if testing MCP):
- GitHub account/organization that owns or bills the Codespace (do not record tokens):
- Repository and branch:
- Codespace name and machine size:

## Extension host and SSH connection

1. Install the release candidate in the selected editor. Confirm the exact extension version and source.
2. Sign into the extension and GitHub CLI separately. Check the CLI account and `codespace` scope with `gh auth status --hostname github.com` without copying token output.
3. Run **Codespaces: Setup Doctor**. Record which checks pass and any unsupported host-specific checks.
4. Use a disposable Codespace or create one only after confirming account, machine size, and billing impact.
5. Refresh the extension list; confirm it displays the expected account, repository, branch, and state.
6. Connect over SSH. Record whether the editor opened the remote workspace and whether `Test SSH Connectivity` completed.
7. Verify a stop/start transition only on the disposable target. Confirm a stale or transitional state is not presented as a safe stop/start state; confirm the dialog names the target and account.
8. Verify current Codespace state and billing in GitHub after the test. Do not delete anything as part of this checklist.

## MCP client workflow

1. Install and configure the optional MCP server using the [setup guide](../mcp-server/SETUP.md). Record client and version; configuration schemas are client-specific.
2. Call `check_setup`. Confirm it reports local Node, GitHub CLI, sign-in/scope, and repository/branch state without creating or starting a Codespace.
3. Call `list_codespaces` or `get_codespace_status` and identify the exact disposable repository/branch target.
4. First run a harmless command without syncing local changes. Record the exact command, returned output, exit status, target, and cleanup result.
5. To test sync, create a small non-secret temporary file in the disposable checkout. Call `preview_local_changes` and inspect all returned paths and size. Pass that preview's `previewId` with `syncLocalChanges: true` to one command that reads only the test file. Confirm the reported output and exit status.
6. Obtain a fresh preview, modify the test file, then try to use the stale preview ID. Confirm the request is rejected before provisioning. Do not count the failed stale-preview check as a successful transfer.
7. Run a harmless command that exits nonzero. Confirm the nonzero exit status is returned and cleanup is reported separately.
8. Repeat a repository command and confirm the same exact repository/branch Codespace is reused rather than duplicated.
9. Verify in GitHub that only test-created or test-started Codespaces were stopped as expected, and review active storage/compute billing. Remove the temporary test file from the disposable repository if needed.

## Evidence and limits

For each step, record **expected**, **observed**, **pass/fail**, and a sanitized screenshot or log excerpt. Do not include tokens, private files, user names you do not have permission to share, or sensitive forwarded URLs. State exact editor/client versions and separate extension-host checks from live service checks. A successful run on one client does not prove compatibility with other versions or editors.

Stop when a check would require broader access, a production target, unexpected spending, or destructive cleanup. Report that as untested rather than changing scope.
