# Marketplace & Distribution Strategy

A step-by-step guide for publishing, promoting, and growing **Antigravity Codespaces Pro** across registries and developer communities.

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
npx @vscode/vsce package --no-git-tag-version
npx ovsx publish antigravity-codespaces-5.0.2.vsix -p <your-token>
```

### Automated Publish via CI (See `open-vsx-publish.yml`)

The workflow in `.github/workflows/open-vsx-publish.yml` automatically publishes to Open VSX on every tagged release (`v*`). Set the `OVSX_PAT` secret in your repository settings once, and every `git tag v4.x.x && git push --tags` will trigger an automatic publish.

---

## 2. VS Code Marketplace (Microsoft)

The Microsoft Marketplace requires a publisher account and is restricted to their proprietary build, but gaining visibility there increases general awareness.

### Setup Steps

1. Create a **Microsoft Azure DevOps** account at [dev.azure.com](https://dev.azure.com).
2. Go to [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) → Create Publisher.
3. Publisher ID must match `package.json` → `"publisher": "nirbhay-hiwse"`.
4. Generate a **Personal Access Token** with `Marketplace → Manage` scope. Save as `VSCE_PAT` in GitHub Secrets.
5. Run: `npx @vscode/vsce publish -p <VSCE_PAT>`

> Note: The extension targets Antigravity IDE / Code-OSS users. Open VSX delivers more targeted reach for this audience.

---

## 3. SEO Metadata Summary

The following metadata is configured in `package.json` for maximum discoverability on Open VSX and search engines (SEO & GEO).

### Keywords Used (30-slot limit)

```
cursor, cursor-ide, cursor-codespaces, cursor-agent, codespaces,
github-codespaces, antigravity, antigravity-ide, remote-development, remote-ssh,
ssh, devcontainer, multi-account, windsurf, vscodium,
code-oss, open-vsx, vscode, cloud-ide, cloud-dev,
ai-agent, ssh-keepalive, websocket-keepalive, port-forwarding, workspace-manager,
developer-tools, productivity, docker, container, github
```

### Gallery Banner

Dark themed banner (`#1a1a2e`) with white text to match the extension icon and dashboard glassmorphism aesthetic.

### Categories

- `Other` (primary)
- `SCM Providers` (secondary — manages GitHub environments)

---

## 4. Community Promotion Channels

### Developer Platforms

| Platform | Action | Link |
|---|---|---|
| **Cursor Community Forum** | Post: "How to connect Cursor IDE to GitHub Codespaces with Multi-Account & KeepAlive" | [forum.cursor.com](https://forum.cursor.com) |
| **Reddit r/cursor** | Guide: Connecting Cursor IDE directly to GitHub Codespaces without Microsoft extension limits | [reddit.com/r/cursor](https://reddit.com/r/cursor) |
| **Reddit r/github** | Post announcement with Bento Cloud Hub dashboard screenshots | [reddit.com/r/github](https://reddit.com/r/github) |
| **Reddit r/vscode** | Cross-post targeting Code-OSS, Antigravity, and VSCodium users | [reddit.com/r/vscode](https://reddit.com/r/vscode) |
| **Hacker News** | "Show HN: Antigravity Codespaces Pro — Codespaces for Cursor & Antigravity IDE" | [news.ycombinator.com](https://news.ycombinator.com) |
| **GitHub Discussions** | Post in `github/codespaces` community discussions | [github.com/github/codespaces](https://github.com/github/codespaces) |

### Content Ideas

1. **"Using GitHub Codespaces in Cursor IDE: The Complete Guide"** — Tutorial on dev.to and Medium explaining how to install from Open VSX and connect in 1 click.
2. **"Why AI Agent Long-Sessions Disconnect (and How to Fix Them)"** — Technical write-up on SSH keepalive tuning for Cursor Agent and Antigravity Agent.
3. **Twitter/X Thread** — "Cursor users: Microsoft's official Codespaces extension isn't on Open VSX. We built the native multi-account Codespaces manager for Cursor & Antigravity IDE (750+ downloads in 24h!)..." with GIF.

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

**Short Description (150 chars):**
> Manage GitHub Codespaces across multiple accounts inside Antigravity IDE & Code-OSS. Connect, start, stop, rebuild with one click.

**Long Description (for marketplace detail page):**
> Antigravity Codespaces Pro brings full GitHub Codespaces management to Code-OSS, Gitpod, Eclipse Theia, and Google Antigravity IDE. The extension provides a Bento Grid visual dashboard, multi-account token isolation, automated SSH config management, AI agent connection keepalive, and a keyboard-first Quick Connect launcher (Alt+C). All Codespace lifecycle operations — start, stop, rebuild, delete, port forwarding — are available directly from the sidebar without touching the browser.

---

## 7. Version & Release Cadence Recommendations

- **Patch releases** (`4.3.x`) — Bug fixes, monthly or on demand.
- **Minor releases** (`4.x.0`) — New features, every 1-2 months.
- **Respond to issues within 48 hours** — Response rate is a strong trust signal on Open VSX.
- **Update `engines.vscode`** minimum version quarterly to keep the extension "compatible with current stable" in search filters.
