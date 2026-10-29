# GitHub Codespaces billing and lifecycle guide

Antigravity Codespaces helps you review and manage Codespaces from a VS Code-based editor. GitHub controls Codespaces billing; the extension displays GitHub-reported status and usage and does not guarantee a cost or a real-time per-Codespace price.

Before a start, create, rebuild, or delete action, confirm the GitHub account and exact Codespace target. For setup, see the [IDE guide](IDE_SETUP.md); for agent-driven remote commands, see the [MCP workflow guide](MCP_CODESPACES_AGENT_GUIDE.md).

## Compute and storage are different charges

- **Running Codespaces consume compute.** Starting or creating a Codespace can incur compute charges, subject to the account or organization's quotas and billing settings.
- **Stopped Codespaces can still consume storage.** Stop ends active compute but does not delete the Codespace or its storage.
- **Deleting is permanent.** Deletion removes the Codespace and its data; use GitHub's current confirmation and retention guidance before proceeding.
- **Organization billing can differ.** The account that owns a Codespace and the organization that pays for it may affect which quota or bill applies.

Prices, included quotas, spending limits, and organizational policies can change. Check the current [GitHub Codespaces billing documentation](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-codespaces/about-billing-for-github-codespaces) and your [personal billing settings](https://github.com/settings/billing) or organization billing settings. The extension is not a substitute for those sources.

## What the extension reports

The Cloud Hub lifecycle view uses GitHub-reported state and machine details. If a state is transitioning or unknown, the extension avoids treating it as stopped. Before a lifecycle action, it re-fetches the selected target and confirms the account, repository, state, and action rather than trusting an old card.

The Usage view reads GitHub's billing API. GitHub updates usage data hourly and the extension caches it for a shorter interval; therefore a refresh can still show delayed usage. Totals are account-level billing figures, not live per-Codespace meters or a promise of the next bill. Compute and storage are separate quota categories and should not be combined.

Usage analytics may request the optional `user` permission. Declining it leaves the extension's core Codespaces browsing and SSH workflow separate; the permission is for usage data, not the Codespaces connection scope.

## Safer lifecycle checklist

Before confirming an action:

1. Check the selected GitHub account and repository.
2. Check the Codespace name and its current state; refresh if the displayed information is stale or uncertain.
3. For **Start** or **Create**, consider whether you need the machine now and review compute quota, spending limits, and idle timeout.
4. For **Stop**, remember that storage can continue to be billed.
5. For **Rebuild**, save or commit important work and review the rebuild's effect on the devcontainer.
6. For **Delete**, verify the exact target and that any needed data is backed up; deletion cannot be undone by the extension.
7. After testing, verify the Codespace state in GitHub and stop a test-only machine when it is no longer needed.

## MCP server cost behavior

The optional MCP server can start or create a Codespace to run a repository command. It attempts to stop a Codespace it started or created after the command completes, including a failed command, but cleanup is best effort. It leaves a Codespace that was already running untouched. Forced termination, machine loss, or GitHub/network failure can prevent cleanup. Read the [MCP safety reference](../mcp-server/README.md) and use an appropriate GitHub idle timeout.

## Data freshness and permission

GitHub-provided usage is updated hourly, not continuously. The extension's refresh/cache interval does not make the underlying source real-time. A missing permission, API failure, stale cache, or organization billing arrangement may limit what is displayed; use GitHub's billing page as the final source for current billing decisions.
