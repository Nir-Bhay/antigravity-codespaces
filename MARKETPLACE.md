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
npx ovsx publish antigravity-codespaces-5.0.1.vsix -p <your-token>
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

The following metadata is already configured in `package.json`. This section documents the reasoning.

### Keywords Used (30-slot limit)

```
codespaces, github-codespaces, remote-development, ssh, devcontainer,
antigravity, antigravity-ide, code-oss, open-vsx, cloud-dev,
multi-account, github, remote-ssh, workspace-manager, cloud-environment,
developer-tools, productivity, ai-agent, websocket-keepalive, port-forwarding,
devops, git, cloud-computing, remote-workspace, container, docker,
vscode-extension, code-editor, workflow, automation
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
| **dev.to** | Write a "How I built X" article linking to the repo | [dev.to](https://dev.to) |
| **Reddit r/github** | Post announcement with use case screenshots | [reddit.com/r/github](https://reddit.com/r/github) |
| **Reddit r/vscode** | Cross-post targeting Code-OSS / fork users | [reddit.com/r/vscode](https://reddit.com/r/vscode) |
| **Hacker News** | "Show HN: Antigravity Codespaces Pro" | [news.ycombinator.com](https://news.ycombinator.com) |
| **GitHub Discussions** | Post in `github/codespaces` community discussions | [github.com/github/codespaces](https://github.com/github/codespaces) |

### Content Ideas

1. **"Connecting Antigravity IDE to GitHub Codespaces: The Missing Extension"** — Blog post for dev.to/Medium explaining the gap this extension solves.
2. **Short demo GIF/video** — Record the flow: open sidebar → see all Codespaces → press Alt+C → connected in 5 seconds.
3. **Tweet/X thread** — "I use Google Antigravity IDE but GitHub Codespaces only works in VS Code. So I built this extension..." with a GIF.

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
