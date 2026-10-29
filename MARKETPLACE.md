# Marketplace & Distribution Strategy

Maintainer guidance for distributing **Antigravity Codespaces Pro** and improving discoverability with accurate, task-focused listing content. Search placement is controlled by each registry and is not guaranteed by metadata changes.

---

## 1. Open VSX Registry (Primary Target)

Open VSX is the vendor-neutral extension registry for Code-OSS, Gitpod, Eclipse Theia, and all non-Microsoft VS Code forks. It is the correct target for this extension.

### One-Time Setup

1. Confirm the publisher account owns the `nirbhay-hiwse` namespace on [Open VSX](https://open-vsx.org).
2. Keep the Open VSX publisher token only in the protected GitHub Actions `production-release` environment as `OVSX_PAT`; do not put it in the repository or pass it as a command-line argument.
3. If the namespace still needs to be claimed, use the publisher's account flow and verify the namespace before publishing.

### Publish

Use the repository's protected `v*` tag workflow after the release commit and version are reviewed. The Open VSX job receives `OVSX_PAT` only in its publish step. A main-branch build or VSIX artifact is not a registry publication. See [release and verification steps](docs/releasing.md).
### Automated Publish via CI (See `open-vsx-publish.yml`)

The workflow in `.github/workflows/open-vsx-publish.yml` automatically publishes to Open VSX on every tagged release (`v*`). Set the `OVSX_PAT` secret in the protected `production-release` environment. Publishing is triggered by a `v*` tag; verify the tag matches the package version and points to the reviewed release commit.

---

## 2. VS Code Marketplace (Microsoft)

The Microsoft Marketplace is a separate registry with its own publisher account and listing. Its description and install copy must be kept current independently; the repository's Open VSX workflow does not update the Microsoft Marketplace.

### Listing update

1. Use the existing publisher account (`nirbhay-hiwse`) in the [Marketplace management portal](https://marketplace.visualstudio.com/manage).
2. Update the overview and install instructions from the reviewed [Marketplace copy proposal](docs/MARKETPLACE_COPY.md). Confirm the released version and VSIX filename on GitHub Releases first.
3. Publish through the Marketplace publisher portal and verify the public overview, version history, and install instructions.

This repository currently has no Microsoft Marketplace publishing workflow and does not use a `VSCE_PAT` secret. If automated Marketplace publishing is added later, configure its credentials through the publisher's approved secure workflow; never place them in docs or command-line arguments. Open VSX and Microsoft Marketplace are separate publication targets.

---

## 3. Search metadata

`package.json` supplies the extension's searchable description and up to 30 keywords. These terms reflect the actual audience and capabilities; metadata can improve relevance for those searches but cannot guarantee a ranking or install count.

### Current keywords

```
cursor, cursor-ide, cursor-codespaces, cursor-agent, codespaces,
github-codespaces, antigravity, antigravity-ide, remote-development, remote-ssh,
ssh, devcontainer, multi-account, windsurf, vscodium,
code-oss, open-vsx, vscode, cloud-ide, cloud-dev,
ai-agent, ssh-keepalive, codespaces-usage, port-forwarding, workspace-manager,
developer-tools, mcp, mcp-server, codespaces-mcp, model-context-protocol
```

Keep the short description factual and front-load the phrases users are likely to search for: GitHub Codespaces, the editor family, SSH connection, usage, and the optional MCP server. Avoid keyword stuffing, unverified compatibility promises, and time-sensitive version strings.

### Gallery Banner

The package sets a dark gallery banner (`#1a1a2e`). Keep screenshots and copy legible in both light and dark contexts, and avoid implying that a visual screenshot demonstrates live account behavior.

### Categories

- `Other` (primary)
- `SCM Providers` (secondary — manages GitHub environments)

---

## 4. Community Promotion Channels

### Developer Platforms

| Platform | Action | Link |
|---|---|---|
| **Cursor Community Forum** | Share an evidence-based setup guide for GitHub Codespaces in Cursor, including authentication and Remote-SSH caveats | [forum.cursor.com](https://forum.cursor.com) |
| **Reddit r/cursor** | Share a practical Cursor-to-GitHub-Codespaces setup guide with version and compatibility notes | [reddit.com/r/cursor](https://reddit.com/r/cursor) |
| **Reddit r/github** | Share an accurate walkthrough of Codespaces setup, usage reporting, and lifecycle controls | [reddit.com/r/github](https://reddit.com/r/github) |
| **Reddit r/vscode** | Cross-post targeting Code-OSS, Antigravity, and VSCodium users | [reddit.com/r/vscode](https://reddit.com/r/vscode) |
| **Hacker News** | Present the extension's verified capabilities, open-source code, limitations, and release status | [news.ycombinator.com](https://news.ycombinator.com) |
| **GitHub Discussions** | Post in `github/codespaces` community discussions | [github.com/github/codespaces](https://github.com/github/codespaces) |

### Content Ideas

1. **GitHub Codespaces in Cursor or Antigravity:** a setup guide covering Open VSX/VSIX choice, the active `gh` account, and editor-specific Remote-SSH limits.
2. **Using an MCP server with GitHub Codespaces:** explain the optional Node.js process, the single-use local-change preview, and potential compute/storage charges.
3. **Understanding Codespaces usage in an editor:** distinguish GitHub-reported billing data, hourly freshness, personal quota, and organization-billed usage.

---

## 5. GitHub Repository Health Checklist

- [x] MIT License
- [x] CHANGELOG.md (Keep a Changelog format)
- [x] CONTRIBUTING.md
- [x] SECURITY.md
- [x] Issue templates (Bug Report, Feature Request)
- [x] PR template
- [x] CI workflow (VSIX build on push)
- [x] GitHub Release with attached VSIX
- [x] Repository topics set
- [ ] Demo GIF in README
- [x] Open VSX CI publish workflow (`.github/workflows/open-vsx-publish.yml`)
- [ ] GitHub Sponsors profile (optional but signals active maintenance)

---

## 6. Extension Listing Copy (for Open VSX / Marketplace)

**Short description:**
> Manage GitHub Codespaces in Antigravity, Cursor, Windsurf, and VS Code-based editors. Connect over SSH, review GitHub-reported usage, or run remote commands with the optional MCP server.

**Long description:**
> Antigravity Codespaces Pro helps you browse and manage GitHub Codespaces from compatible VS Code-based editors. Use the sidebar and Cloud Hub to review Codespaces, connect over SSH, and manage lifecycle actions. Usage figures come from GitHub's billing API and can be delayed; check GitHub billing for current charges.
>
> The optional Model Context Protocol (MCP) server is a separate Node.js process for AI clients that need to run commands in a Codespace. It uses the active GitHub CLI account on the machine that starts the client. It is not installed or signed in by the editor extension. Local-change transfer is opt-in and requires reviewing a short-lived preview; Codespace provisioning can incur charges.
>
> Gallery availability does not guarantee that a specific editor version or Remote-SSH provider has been tested. See the [IDE compatibility guide](docs/IDE_SETUP.md), [MCP setup guide](mcp-server/SETUP.md), and [billing guide](docs/CODESPACES_COST_GUIDE.md) for requirements and limits.

---

## 7. Version and release guidance

- Follow the package's current major version and Semantic Versioning: patch for compatible fixes, minor for compatible features, and major for breaking changes.
- Keep the `CHANGELOG.md`, release notes, package version, and exact VSIX asset name aligned for each release.
- The `build-and-release.yml` workflow builds on pull requests and pushes to `main`; GitHub Release publication runs only for a `v*` tag. Open VSX publication is a separate `v*`-tag workflow. A successful main-branch build is not publication.
- Before announcing an update, verify the GitHub Release assets and independently check each registry listing/version. Update the Microsoft Marketplace manually through its publisher process when authorized; do not imply the repository's Open VSX workflow publishes there.
