# Marketplace & Distribution Strategy

Maintainer guidance for distributing **Antigravity Codespaces Pro** and improving discoverability with accurate, task-focused listing content. Search placement is controlled by each registry and is not guaranteed by metadata changes.

---

## 1. Open VSX Registry (Primary Target)

Open VSX is the vendor-neutral extension registry for Code-OSS, Gitpod, Eclipse Theia, and all non-Microsoft VS Code forks. It is the correct target for this extension.

### One-Time Setup

1. **Create an account** at [open-vsx.org](https://open-vsx.org) using your GitHub account (`Nir-Bhay`).
2. **Generate an access token**: User Settings → Access Tokens → Generate New Token. Save this as a GitHub repository secret named `OVSX_PAT`.
3. **Claim the namespace**:
   ```bash
   npx ovsx create-namespace nirbhay-hiwse -p <your-token>
   ```
   This associates the `nirbhay-hiwse` publisher namespace with your account and marks future uploads as **verified**.

### Manual Publish (First Time)

```bash
# From the repo root after building the VSIX
npx @vscode/vsce package --no-git-tag-version --allow-missing-repository --skip-license
npx ovsx publish antigravity-codespaces-<version>.vsix -p "$OVSX_PAT"
```

### Automated Publish via CI (See `open-vsx-publish.yml`)

The workflow in `.github/workflows/open-vsx-publish.yml` automatically publishes to Open VSX on every tagged release (`v*`). Set the `OVSX_PAT` secret in the protected `production-release` environment. Publishing is triggered by a `v*` tag; verify the tag matches the package version and points to the reviewed release commit.

---

## 2. VS Code Marketplace (Microsoft)

The Microsoft Marketplace is a separate registry with its own publisher account and listing. Its description and install copy must be kept current independently; the repository's Open VSX workflow does not update the Microsoft Marketplace.

### Setup Steps

1. Create a **Microsoft Azure DevOps** account at [dev.azure.com](https://dev.azure.com).
2. Go to [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) → Create Publisher.
3. Publisher ID must match `package.json` → `"publisher": "nirbhay-hiwse"`.
4. Generate a **Personal Access Token** with `Marketplace → Manage` scope. Save as `VSCE_PAT` in GitHub Secrets.
5. Run: `npx @vscode/vsce publish -p "$VSCE_PAT"`

> Note: The extension targets Antigravity IDE / Code-OSS users. Open VSX delivers more targeted reach for this audience.

---

## 3. Search metadata

`package.json` supplies the extension's searchable description and up to 30 keywords. These terms reflect the actual audience and capabilities; metadata can improve relevance for those searches but cannot guarantee a ranking or install count.

### Current keywords

```
cursor, cursor-ide, cursor-codespaces, cursor-agent, codespaces,
github-codespaces, antigravity, antigravity-ide, remote-development, remote-ssh,
ssh, devcontainer, multi-account, windsurf, vscodium,
code-oss, open-vsx, vscode, cloud-ide, cloud-dev,
ai-agent, ssh-keepalive, websocket-keepalive, port-forwarding, workspace-manager,
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

**Short Description (under 150 characters):**
> Manage GitHub Codespaces in Antigravity, Cursor, Windsurf, and VS Code; connect over SSH, view usage, or run commands with optional MCP.

**Long Description (for marketplace detail pages):**
> Antigravity Codespaces Pro is an open-source VS Code extension for browsing GitHub Codespaces across configured accounts, connecting through the GitHub CLI and Remote-SSH, managing Codespace lifecycle actions, and viewing GitHub-reported usage. A separate optional Node.js MCP server lets an MCP client run commands in a named or repository-matched Codespace. MCP uses the active `gh` CLI account, not the extension's sign-in. Starting or creating a Codespace may incur compute charges, and stopped Codespaces may continue to incur storage charges. Editor and MCP-client compatibility must be checked for the specific host/version; marketplace availability alone does not prove integration behavior.

---

## 7. Version and release guidance

- Follow the package's current major version and Semantic Versioning: patch for compatible fixes, minor for compatible features, and major for breaking changes.
- Keep the `CHANGELOG.md`, release notes, package version, and exact VSIX asset name aligned for each release.
- The `build-and-release.yml` workflow builds on pull requests and pushes to `main`; GitHub Release publication runs only for a `v*` tag. Open VSX publication is a separate `v*`-tag workflow. A successful main-branch build is not publication.
- Before announcing an update, verify the GitHub Release assets and independently check each registry listing/version. Update the Microsoft Marketplace manually through its publisher process when authorized; do not imply the repository's Open VSX workflow publishes there.
