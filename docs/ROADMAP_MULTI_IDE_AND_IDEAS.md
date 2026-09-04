# Future Roadmap: Multi-IDE Connector Strategy + New Ideas (Research Doc — No Code Changed)

Date: 2026-09-05 | Status: research + proposal only. Nothing implemented.

## 0. Executive answer to your idea

**You do NOT need a separate "Codespace Connector" extension for Cursor.**
Research shows one adaptive extension beats N per-IDE extensions:

| Fact (with source) | Implication |
|---|---|
| Cursor moved to the **OpenVSX Registry in June 2025** (rapidevelopers.com, 2026 guide; Cursor docs) | Our extension is **already published on OpenVSX as v5.0.1** → Cursor users can likely discover + install it from inside Cursor today, zero extra work. Verify by searching "Antigravity Codespaces" in Cursor's Extensions panel. |
| Manual VSIX install works in Cursor: `Extensions: Install from VSIX…`, drag-drop into Extensions tab, `cursor --install-extension x.vsix` (Cursor forum, testers.ai guide) | Fallback distribution path already exists; our GitHub Release VSIX covers it. |
| Remote connect works the same: `cursor --remote ssh-remote+host path` and `cursor --folder-uri vscode-remote://ssh-remote+host/path` (StackOverflow, Messa) | Our Tier-3 launcher design already fits Cursor — only the binary discovery list (`findAntigravityExecutable`) lacks `cursor`/`windsurf` entries. |
| In-IDE `vscode.openFolder` with `vscode-remote` authority resolves inside Cursor's own remote stack (Harvard FASRC docs; KodeKloud guide) | Our Tier-1 connect path should work in Cursor **unmodified**. |
| ⚠️ Known Cursor bug (Feb 2026): `--folder-uri vscode-remote://…` **hangs when Cursor is already running** (Cursor forum #153009) | For Cursor hosts, prefer Tier-2 (in-IDE remote-SSH command) over Tier-3 CLI spawn. Our tiered fallback already supports this ordering — it just needs host-aware ordering. |
| ⚠️ Cursor replaced Microsoft's Remote-SSH with **Anysphere's Remote-SSH**; extensions probing `ms-vscode-remote.*` command IDs break (Cursor forum, AWS Toolkit thread) | Our Tier-2 already probes multiple command IDs (`open-remote-ssh.*`, `vsx-remote-ssh.*`, `remote-ssh.*`) — needs Anysphere's IDs added to the probe list (verification step below). |
| `vscode.env.appName` / `vscode.env.uriScheme` expose the host at runtime on every fork | Host detection is ~20 lines: no separate extension, no fork of the codebase. |

**Verdict:** implement a **Multi-IDE Adapter layer** inside the existing extension
(~150–250 lines + docs + per-IDE test matrix), not a new extension. Estimated effort:
S–M. A separate "connector" would duplicate 95% of the code (auth, API, SSH, webviews)
for zero benefit and 2× maintenance forever.

## 1. Proposed design: IDE Adapter (future work, not started)

### 1.1 Host detection (runtime, no config needed)

```js
// Proposed: src/ideAdapter.js (new file, ~120 lines)
const IDE_PROFILES = {
  'cursor':     { label: 'Cursor',        binaries: ['cursor', 'cursor.cmd'],        remoteCmds: ['anysphere-remote-ssh.connect', 'open-remote-ssh.connectToHostInNewWindow', ...], preferInIdeConnect: true },
  'antigravity':{ label: 'Antigravity IDE', binaries: ['antigravity-ide', 'antigravity'], remoteCmds: ['open-remote-ssh.connectToHostInNewWindow', 'vsx-remote-ssh.connectHost', 'remote-ssh.connectHost'] },
  'vscode':     { label: 'VS Code',       binaries: ['code', 'code.cmd'],            remoteCmds: ['remote-ssh.connectHost', ...] },
  'vscodium':   { label: 'VSCodium',      binaries: ['codium'],                      remoteCmds: ['vsx-remote-ssh.connectHost', ...] },
  'windsurf':   { label: 'Windsurf',      binaries: ['windsurf'],                    remoteCmds: [...] }, // IDs TBD — research item
};
// Detect: vscode.env.appName (+ uriScheme as tiebreak). Unknown host → generic profile (current behavior).
```

Detection inputs to verify per host (test matrix §1.4): `vscode.env.appName`,
`vscode.env.uriScheme`, presence of remote-SSH command IDs, CLI binary names.

### 1.2 "Open In…" target picker (your "switch IDE" idea, concrete shape)

- Dashboard card + sidebar menu gain **"Open In…"** submenu listing IDEs **detected as installed**
  on the machine (PATH scan of known binaries: `cursor`, `antigravity-ide`, `code`, `windsurf`, `codium`).
- User picks target per connection; choice remembered per workspace (`globalState`).
- Status bar tooltip + dashboard header show **current host IDE** ("Running in Cursor · target: Antigravity").
- This delivers your vision — "user can see/manage across IDEs" — without leaving the extension.

### 1.3 Changes to existing code (when we do it)

1. `findAntigravityExecutable()` → generalized `findIdeExecutable(profile)` (+ `cursor`, `windsurf`, `codium` candidates).
2. Tier-2 probe list becomes profile-driven (add Anysphere IDs; keep generic fallbacks).
3. Tier ordering becomes host-aware (Cursor: Tier-2 before Tier-3, per the CLI-hang bug).
4. New `antigravity-codespaces.targetIde` setting (`auto` default) + `Open In…` menu wiring.
5. Docs: per-IDE install section in README (Cursor: OpenVSX search or VSIX; Windsurf: VSIX).

### 1.4 Verification matrix (must pass before claiming support)

| Host | Install via | Connect Tier-1 | Tier-2 cmd IDs | Tier-3 CLI | Notes |
|---|---|---|---|---|---|
| Antigravity IDE | OpenVSX / VSIX | ✅ (current) | probed | ✅ | baseline |
| Cursor | OpenVSX search ❓ verify | verify | Anysphere IDs ❓ verify | ⚠️ hang bug → deprioritize | check marketplace visibility first |
| VS Code | Marketplace (roadmap) / VSIX | verify | `ms-vscode-remote.*` | ✅ | needs Marketplace listing for 1-click |
| VSCodium | OpenVSX | verify | `vsx-remote-ssh.*` | ✅ | |
| Windsurf | VSIX (marketplace ❓ research) | verify | IDs ❓ research | verify | |

Research items still open: exact Anysphere remote-SSH command IDs; Windsurf marketplace
policy + remote command IDs; whether our OpenVSX listing is already searchable inside
Cursor (5-minute manual check).

### 1.5 Risks (honest)

- Cursor/Anysphere can change command IDs or restrict third-party remote flows at any time
  (precedent: AWS Toolkit breakage, Oct 2025 thread). Mitigation: generic fallbacks first,
  profile overrides second; never hard-depend on one ID.
- The Cursor CLI-hang bug is upstream; our workaround is ordering, not a fix.
- Microsoft-proprietary extensions are blocked on forks — irrelevant to us (zero deps, pure JS).

## 2. More roadmap ideas (mine) — impact × effort

### P0 — Do next (small effort, visible payoff)

1. **Demo GIF in README + OpenVSX page** — single biggest conversion lever; 30-sec
   record of sidebar → Alt+C → connect. (README checklist still has this unchecked.)
2. **VS Code Marketplace listing** — unlocks 1-click install for the largest audience;
   needs `VSCE_PAT` (same 5-minute secret flow as `OVSX_PAT`).
3. **Bulk actions** — multi-select cards (Start/Stop/Delete N at once). Dashboard state
   model already supports selection; medium UI work, high user value for 8+ workspaces.
4. **Cost estimator** — hours × machine rate per codespace from `lastUsedAt`/state;
   read-only math, no new API. Pairs with your billing-widget roadmap item.

### P1 — High value, medium work

5. **Auto-stop scheduler** — per-workspace idle timeout override + "stop all at 20:00"
   rule; saves real money, differentiates from the browser tab.
6. **Port visibility + share** — toggle public/private, copy URL, QR for mobile testing.
7. **Offline action queue** — Start/Stop tapped offline execute on reconnect (auth layer
   already tolerates offline; extend to mutations with explicit pending UI).
8. **Chat participant `@codespaces`** — natural-language "stop everything except X";
   cheap on our command layer, big demo factor.
9. **Hindi + Hinglish UI strings (i18n)** — you think in Hindi; a large share of new
   coders do too. `vscode.l10n` bundle, start with hi + en. Unique among Codespaces tools.

### P2 — Strategic (larger bets)

10. **Team/org mode** — shared workspace directory (who runs what, on which repo),
    read-only org view via `gh api`. Turns a personal tool into a team tool.
11. **Dotfiles + template picker** — new-Codespace wizard gains dotfiles repo +
    devcontainer templates (already on your roadmap; bundle together).
12. **Usage insights** — hours/machine history chart from cached snapshots; local-only,
    privacy-safe (aligns with our no-telemetry posture — make that a selling point).
13. **Corporate proxy pack** — documented `HTTP_PROXY`/`NODE_EXTRA_CA_CERTS` support +
    PAT-first onboarding; unlocks enterprise users behind firewalls.
14. **Windows ARM + remote-SSH server check** — extend SystemDoctor; cheap, widens hardware coverage.

### My top-5 recommended order

1. Demo GIF (growth) → 2. Marketplace listing (growth) → 3. Multi-IDE adapter §1
   (your Cursor idea, S–M) → 4. Bulk actions (power users) → 5. Auto-stop scheduler
   (money saver = retention). Then cost estimator + i18n as differentiators.

## 3. Suggested roadmap file update (for later)

When approved, fold §1 + P0–P2 into README Roadmap as Now / Next / Later columns and
mirror them as GitHub issues with `effort:S/M/L` labels. Not done in this pass
(doc-only by your instruction).
