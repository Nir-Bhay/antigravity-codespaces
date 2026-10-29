# Marketplace listing copy

This file is a reviewed copy proposal for the Visual Studio Marketplace listing. Updating repository files does **not** change the listing; a publisher must update the external Marketplace entry and verify the published version separately.

## Short description

Manage GitHub Codespaces in Antigravity, Cursor, Windsurf, and VS Code-based editors. Connect over SSH, review GitHub-reported usage, or run remote commands with the optional MCP server.

## Overview

Antigravity Codespaces Pro helps you browse and manage GitHub Codespaces from compatible VS Code-based editors. Use the sidebar and Cloud Hub to review Codespaces, connect over SSH, and manage lifecycle actions. Usage figures come from GitHub's billing API and can be delayed; check GitHub billing for current charges.

The optional Model Context Protocol (MCP) server is a separate Node.js process for AI clients that need to run commands in a Codespace. It uses the active GitHub CLI account on the machine that starts the client. It is not installed or signed in by the editor extension. Local-change transfer is opt-in and requires reviewing a short-lived preview; Codespace provisioning can incur charges.

Install from the [Open VSX listing](https://open-vsx.org/extension/nirbhay-hiwse/antigravity-codespaces) or download a versioned VSIX from [GitHub Releases](https://github.com/Nir-Bhay/antigravity-codespaces/releases). Gallery availability and listing do not guarantee that a particular editor version or Remote-SSH provider has been tested. See the [compatibility guide](https://github.com/Nir-Bhay/antigravity-codespaces/blob/main/docs/IDE_SETUP.md), [MCP setup guide](https://github.com/Nir-Bhay/antigravity-codespaces/blob/main/mcp-server/SETUP.md), and [billing guide](https://github.com/Nir-Bhay/antigravity-codespaces/blob/main/docs/CODESPACES_COST_GUIDE.md) for requirements and limits.

## Publisher checklist before applying

- Confirm the released version and exact VSIX filename on GitHub Releases; do not copy a version from an older listing.
- Update the overview and install text in the Marketplace publisher portal. This repository cannot publish that external page by changing this file.
- Verify the visible listing, version history, and install instructions after the update.
- Keep screenshots current and free of personal account data. Do not retain claims such as "one click", "under 5 seconds", "enterprise", or universal editor support unless the specific claim is verified and appropriately scoped.
