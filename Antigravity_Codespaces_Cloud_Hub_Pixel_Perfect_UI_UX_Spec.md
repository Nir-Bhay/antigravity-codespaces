# Antigravity Codespaces Cloud Hub
## Pixel-Perfect UI/UX Implementation Specification

**Document type:** Agent-ready UI/UX + interaction + responsive implementation specification  
**Primary target:** Full-page Cloud Hub Webview inside Antigravity IDE / VS Code-style environment  
**Reference artwork:** `Codespaces Cloud Hub` approved dashboard mockup, 1536 × 1024 reference image  
**Source content:** Dashboard specification supplied for the extension  
**Design goal:** Recreate the approved dashboard as closely as possible while preserving the supplied content, behavior, hierarchy, and actions.

---

## 0. Critical Implementation Instruction

This document is the implementation contract for the dashboard UI.

The dashboard should be treated as a **high-density developer workspace manager**, not as a marketing page.

The implementation must:

1. Preserve the supplied product content and action semantics.
2. Match the approved visual composition and hierarchy.
3. Be fully responsive and reflow cleanly when the Webview is resized, moved, zoomed, or rendered at different viewport sizes.
4. Prefer native VS Code visual language and product icons where available.
5. Use semantic HTML, keyboard navigation, accessible names, focus states, and reduced-motion behavior.
6. Avoid adding decorative features that change the supplied information architecture.
7. Keep secondary/destructive actions visually subordinate to primary workflow actions.
8. Ensure every state has a deterministic layout: loading, loaded, empty, filtered-empty, error, modal, provisioning, toast, and destructive confirmation.
9. Keep the dashboard useful at narrow widths instead of allowing horizontal overflow.
10. Build reusable components rather than individually styling each card.

**Important:** The reference image is a visual target, not a source DOM. Pixel-perfect means the implementation should intentionally reproduce its measured composition, spacing rhythm, typography hierarchy, card density, control sizes, alignment, and interaction affordances.

---

# 1. Product Intent

### Product identity

**Product:** Antigravity Codespaces  
**Dashboard name:** Antigravity Codespaces Cloud Hub  
**Context:** Cloud development workspace management from inside the IDE  
**Primary job:** Let a developer see all Codespaces across multiple GitHub accounts, understand their current state, and perform common lifecycle actions without leaving the IDE.

### User mental model

The user should immediately understand:

- what is running,
- what is stopped,
- which GitHub account owns a workspace,
- which repository and branch are attached,
- when the workspace was last active,
- whether an idle shutdown timer is active,
- how to connect,
- how to start or stop,
- how to access the browser,
- how to test SSH,
- how to rebuild,
- how to copy an SSH command,
- and how to delete.

### Design principle

The page should feel like:

> **A calm, professional cloud infrastructure control panel embedded inside a developer tool.**

It should not feel like:

- a generic enterprise analytics dashboard,
- a flashy startup landing page,
- a crypto dashboard,
- a consumer admin panel,
- or a decorative SaaS template.

---

# 2. Reference Composition

## 2.1 Reference viewport

The approved reference image is:

- Width: **1536 px**
- Height: **1024 px**
- Orientation: landscape
- Overall structure: left navigation rail + large content canvas

The main dashboard reference is visually divided into:

1. Persistent left navigation.
2. Header / page identity region.
3. Header action group.
4. KPI summary row.
5. Filter + search row.
6. Four-column workspace grid.
7. Overlay/stack examples of modal/wizard states and toast feedback.

The implementation should treat the dashboard itself as the base surface and dialogs/toasts as separate overlay layers.

---

# 3. Global Design System

## 3.1 Layout principles

Use a 12-column mental grid for the content canvas, but implement using CSS Grid/Flexbox rather than a literal 12-column layout everywhere.

### Main page structure

```text
┌───────────────────────────────────────────────────────────────┐
│ LEFT NAV │ HEADER                                             │
│          │----------------------------------------------------│
│          │ KPI GRID                                            │
│          │----------------------------------------------------│
│          │ FILTERS / SEARCH                                    │
│          │----------------------------------------------------│
│          │ WORKSPACE GRID                                     │
│          │                                                     │
│          │                                                     │
└───────────────────────────────────────────────────────────────┘
```

### Recommended top-level CSS

```css
.dashboard-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
}

.dashboard-main {
  min-width: 0;
  padding: 18px 18px 22px;
}
```

At very narrow widths the left navigation must collapse instead of forcing a minimum desktop width.

---

# 4. Recommended Breakpoints

The Webview must not assume a fixed desktop-only viewport.

## Breakpoint A: Compact

**< 640 px**

Behavior:

- Hide full navigation labels.
- Collapse navigation to icon rail or mobile drawer.
- KPI tiles become a 2-column grid.
- Workspace cards become 1 column.
- Search takes the full row.
- Account chips can horizontally scroll.
- Header action labels can become icon-only with tooltips.
- Card utility actions stay accessible through an overflow menu if space becomes constrained.

## Breakpoint B: Tablet / narrow desktop

**640–999 px**

Behavior:

- Navigation may remain compact.
- KPI tiles: 2 columns.
- Workspace cards: 2 columns.
- Filter and search may share a row where possible.
- Header primary button retains its text.
- Secondary header buttons may become icon + tooltip.

## Breakpoint C: Standard desktop

**1000–1279 px**

Behavior:

- Navigation: full 220 px.
- KPI tiles: 4 columns if space allows.
- Workspace cards: 2–3 columns depending on content width.
- Search remains in filter row.
- Card actions use full dock.

## Breakpoint D: Wide desktop

**1280–1599 px**

Behavior:

- Navigation: approximately 220 px.
- Main content uses available width.
- Workspace grid: 4 columns.
- KPI grid: 4 columns.
- Full action labels.
- Reference image composition should be closest to this range.

## Breakpoint E: Very wide

**1600 px+**

Do not continuously stretch cards.

Use a maximum readable content width or a sensible card max-width and keep grid density stable.

Recommended:

```css
.dashboard-content {
  width: 100%;
  max-width: 1440px;
  margin-inline: auto;
}
```

---

# 5. Visual Language

The approved design uses a light, clean, restrained developer-dashboard appearance.

## 5.1 Background hierarchy

Use a subtle three-level surface hierarchy:

1. **Application background**
   - Very light neutral.
   - Serves as page canvas.

2. **Surface / card**
   - White or near-white.
   - Used for KPI cards, workspace cards, modal cards.

3. **Interactive surface**
   - Slightly tinted / highlighted.
   - Used for active filters, selected wizard options, hover states.

Avoid heavy gradients.

Avoid excessive glassmorphism.

Avoid large decorative illustrations in the main dashboard.

---

# 6. Color System

The supplied specification intentionally omitted colors, so the colors below define the approved visual interpretation of the generated reference.

## 6.1 Primary blue

Use a GitHub/IDE-oriented utility blue.

Suggested implementation token:

```css
--hub-accent: #0B75F0;
--hub-accent-strong: #0563D6;
--hub-accent-soft: #EAF4FF;
```

Primary blue is used for:

- New Codespace button.
- Connect button.
- active filter ring.
- selected wizard controls.
- links.
- focus indication where appropriate.
- progress indication.

## 6.2 Running green

```css
--hub-success: #16A34A;
--hub-success-soft: #EAF8EF;
```

Use for:

- running dot,
- running badge,
- running KPI icon,
- positive confirmation icon,
- Start button on stopped cards.

## 6.3 Stopped / neutral

```css
--hub-neutral: #64748B;
--hub-neutral-soft: #F1F5F9;
```

Use for:

- stopped dot,
- neutral metadata,
- inactive indicators.

## 6.4 Warning amber

```css
--hub-warning: #D97706;
--hub-warning-soft: #FFF7E6;
```

Use for:

- idle timeout indicator,
- attention-needed states.

## 6.5 Danger red

```css
--hub-danger: #E11D48;
--hub-danger-soft: #FFF0F2;
```

Use only for:

- Delete.
- destructive confirmation.
- hard failure state.

Do not use red as a general accent.

---

# 7. Border, Radius, Shadow, and Elevation

## 7.1 Border

The design is border-led rather than shadow-led.

Default:

```css
--border: #DCE3EC;
```

Use:

```css
border: 1px solid var(--border);
```

## 7.2 Radius

Recommended tokens:

```css
--radius-xs: 6px;
--radius-sm: 8px;
--radius-md: 10px;
--radius-lg: 12px;
--radius-xl: 14px;
```

Use:

- button: 8–10 px
- input: 9–10 px
- card: 10–12 px
- KPI: 10–12 px
- modal: 12 px
- toast: 10–12 px
- pill/badge: 999px

## 7.3 Shadow

Keep shadows subtle.

```css
--shadow-card:
  0 1px 2px rgba(15, 23, 42, 0.04),
  0 6px 20px rgba(15, 23, 42, 0.04);

--shadow-modal:
  0 18px 50px rgba(15, 23, 42, 0.16);
```

Cards should not appear floating dramatically.

---

# 8. Typography

## 8.1 Font strategy

Use the UI font already used by the host application where possible.

For a VS Code webview:

```css
font-family:
  var(--vscode-font-family),
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

Use the editor font only for technical data such as:

- branch,
- CLI commands,
- repository identifiers where needed.

```css
font-family: var(--vscode-editor-font-family), monospace;
```

## 8.2 Size scale

Recommended:

```text
Page title         22–24 px / 700
Page subtitle      13–14 px / 400
Section label      11–12 px / 600 uppercase
KPI number         28–32 px / 700
Card title         14–15 px / 650–700
Card metadata      12–13 px / 400–500
Button label       12–13 px / 600
Utility tooltip    11–12 px
Modal title        15–17 px / 700
```

## 8.3 Line height

- page title: ~1.15
- body: ~1.45
- metadata: ~1.3
- button: 1.0
- modal body: ~1.4

---

# 9. Navigation Rail

## 9.1 Width

Desktop target:

**220 px**

## 9.2 Navigation structure

Top:

```text
[Cloud Icon] Codespaces
```

Primary navigation:

```text
[Home] Cloud Hub
[Server] My Codespaces
[Plus] Create New
[User] Accounts
[Gear] Settings
```

Bottom identity area:

```text
Antigravity IDE
Build anywhere.
v1.0.0
```

## 9.3 Active item

Cloud Hub is active.

Visual rules:

- full-width item inside content padding;
- subtle blue-tinted background;
- blue icon;
- darker text;
- rounded rectangle;
- no heavy gradient.

## 9.4 Navigation spacing

Suggested:

```text
left/right rail padding: 10–12 px
nav item height:         38–40 px
icon box:                20 × 20 px
gap icon → label:        10 px
item radius:             8–9 px
```

## 9.5 Mobile navigation

At <640 px:

- convert the rail into a 56–64 px icon bar, OR
- use a drawer.
- Never stack the full 220 px navigation beside a one-column card list.

---

# 10. Page Header

## 10.1 Header alignment

Main header has two horizontal groups.

### Left group

Cloud logo + title block.

```text
[Cloud]
Antigravity Codespaces Cloud Hub
Multi-Account Cloud Workspace Director · Enterprise Edition
```

### Right group

```text
[+ New Codespace]
[↔ Sync SSH]
[↻ Refresh]
[Theme]
[Avatar ▼]
```

## 10.2 Cloud icon

The generated design uses a simple filled cloud mark.

Recommended SVG characteristics:

- geometric cloud;
- no gradients;
- smooth round corners;
- clean silhouette;
- blue accent;
- visually balanced at 32–40 px.

A custom SVG may be used for the brand mark because it is a product identity asset.

Example:

```svg
<svg viewBox="0 0 48 48" aria-hidden="true">
  <path
    d="M14 35h21a9 9 0 0 0 1-18 12 12 0 0 0-23-2A10 10 0 0 0 14 35Z"
    fill="currentColor"/>
</svg>
```

Do not copy the exact logo from GitHub. Use the product's own cloud mark.

---

# 11. Header Action Buttons

## 11.1 New Codespace

Primary CTA.

Content:

```text
+  New Codespace
```

Approximate dimensions:

- height: 38–40 px
- horizontal padding: 14 px
- icon: 16 px
- icon-to-label gap: 7–8 px

Use blue filled treatment.

## 11.2 Sync SSH

Content:

```text
↔  Sync SSH
```

Secondary outlined button.

Purpose:

- generate/write ProxyCommand SSH configuration blocks for all Codespaces.

## 11.3 Refresh

Content:

```text
↻  Refresh
```

Secondary outlined button.

While running:

- rotate the icon.
- do not make the entire button pulse.

## 11.4 Theme toggle

Icon-only square.

Recommended size:

**38 × 38 px**

Tooltip:

```text
Toggle Dark / Light Theme
```

## 11.5 Account control

Reference uses compact avatar + chevron.

Recommended:

- 32 px avatar
- 8 px chevron gap
- no large dropdown field treatment

The current active account can be indicated by the avatar rather than repeating a long username in the top header.

---

# 12. KPI Metrics Row

## 12.1 Grid

Desktop:

```css
grid-template-columns: repeat(4, minmax(0, 1fr));
gap: 14px;
```

Compact:

```css
grid-template-columns: repeat(2, minmax(0, 1fr));
```

Mobile:

```css
grid-template-columns: 1fr;
```

## 12.2 KPI card dimensions

Approximate desktop target:

- height: 84–90 px
- padding: 15–16 px
- radius: 10–12 px

Layout:

```text
┌─────────────────────────────────┐
│ [Icon]  LABEL                   │
│         8                       │
└─────────────────────────────────┘
```

## 12.3 Tile 1

Label:

```text
TOTAL WORKSPACES
```

Value:

```text
8
```

Icon:

Server / database-like server icon.

## 12.4 Tile 2

Label:

```text
RUNNING INSTANCES
```

Value:

```text
2
```

Icon:

Power icon.

Running visual accent:

Green.

## 12.5 Tile 3

Label:

```text
STOPPED (SAVED)
```

Value:

```text
6
```

Icon:

Clock.

Accent:

Amber / warm neutral.

## 12.6 Tile 4

Label:

```text
STORAGE TIER
```

Value:

```text
15 GB Free Tier
```

Icon:

Shield.

Add right chevron to communicate that storage tier may be inspected or expanded later.

---

# 13. KPI Icon Treatment

Each KPI icon sits inside a soft circular or rounded icon container.

Approximate:

```text
icon wrapper: 44 × 44 px
glyph:        20–22 px
```

The icon wrapper is a contextual accent surface, not a colored full card.

---

# 14. Filter + Search Toolbar

## 14.1 Row composition

Desktop:

```text
[ All Accounts 8 ] [ Nir-Bhay 3 ] [ octocat 3 ] [ github 2 ]       [ Search... ] [Grid] [List]
```

Left side:

- account chips

Right side:

- search
- optional layout toggle

The generated reference shows a grid/list control beside the search field. This is an approved visual affordance and can remain in the implementation as a view-mode control if the product supports both modes.

## 14.2 Account chips

Each chip consists of:

```text
[Avatar] Name [Count]
```

Example:

```text
ALL    All Accounts   8
NI     Nir-Bhay       3
OC     octocat        3
GH     github         2
```

## 14.3 Active chip

The active chip uses:

- blue border or blue outline;
- subtle blue surface;
- stronger text weight;
- active avatar accent.

No large filled blue pill that visually dominates the dashboard.

## 14.4 Search input

Placeholder:

```text
Search by name, repository, branch... (Press / to focus)
```

Height:

**40–42 px**

Icon:

Search / magnifying glass.

Keyboard indicator:

```text
/
```

The slash hint is shown as a small keycap inside the right side of the input.

---

# 15. Search Behavior

Search matches against:

1. Codespace name/display name.
2. Repository name / full `owner/repo`.
3. Git branch.

### Slash shortcut

Global:

```text
/
```

Action:

- prevent default browser behavior if appropriate;
- focus search;
- select current search text.

### Escape

When input focused:

1. clear search text;
2. restore all cards;
3. remove search focus.

Do not close unrelated dialogs with Escape if a modal is active unless modal behavior explicitly allows it.

---

# 16. Workspace Grid

## 16.1 Desktop grid

Reference target:

**4 columns**

```css
grid-template-columns:
  repeat(4, minmax(0, 1fr));
gap: 12px;
```

Use `minmax(260px, 1fr)` only if the available width supports it.

Recommended dynamic strategy:

```css
.workspace-grid {
  display: grid;
  grid-template-columns:
    repeat(auto-fit, minmax(285px, 1fr));
  gap: 12px;
}
```

Then constrain maximum columns through available dashboard width.

## 16.2 Card height

Reference target:

Approximately **200 px** depending on content and action dock.

Cards should remain visually consistent even when branch names or repository names differ.

Long content must truncate rather than increase every card's height.

---

# 17. Workspace Card Anatomy

## 17.1 Card layout

```text
┌─────────────────────────────────────────────┐
│ ● workspace-name                   ⋮        │
│   avatar   account              RUNNING     │
│                                             │
│  repo icon  owner/repository               │
│  branch    main                              │
│  clock     Active 12m ago     moon Idle... │
│                                             │
│ [Connect] [Stop]    [SSH][Web][Build][CLI][Delete]
└─────────────────────────────────────────────┘
```

## 17.2 Card padding

Recommended:

```text
top:    13–14 px
right:  11–12 px
bottom: 11–12 px
left:   12–13 px
```

## 17.3 Status dot

Running:

- size 8–10 px;
- green;
- optional subtle outer pulse.

Stopped:

- size 8–10 px;
- neutral gray;
- no pulse.

### Pulse

Use only for genuinely live states.

Animation:

```css
@keyframes radar-pulse {
  0%   { transform: scale(1); opacity: .45; }
  70%  { transform: scale(1.65); opacity: 0; }
  100% { transform: scale(1.65); opacity: 0; }
}
```

Respect reduced motion by disabling it.

---

# 18. Workspace Title

Primary:

```text
displayName
```

Fallback:

```text
name
```

Font:

- 14–15 px
- 650–700 weight
- dark/high-contrast foreground

Maximum:

- 1–2 lines
- truncate after 2 lines.

Tooltip:

```text
<full display name>
```

If the display name is long, the three-dot menu must remain aligned to the top-right rather than shifting.

---

# 19. Account Tag

Below/adjacent to title:

```text
[Avatar] Nir-Bhay
```

Avatar:

- 20–22 px
- circular
- GitHub profile image when available
- initials fallback.

Use the account tag as an identity clue, not a decorative badge.

---

# 20. Status Badge

Running:

```text
RUNNING
```

Stopped:

```text
STOPPED
```

Style:

- compact pill;
- uppercase;
- 10–11 px;
- semibold.

Running pill uses success-soft surface + success text.

Stopped pill uses danger-soft or neutral-soft surface depending on the system tone.

In the approved image, STOPPED has a subtle red tint. Preserve this visual behavior.

---

# 21. Repository Metadata Row

Icon:

Repository / book icon.

Content:

```text
Nir-Bhay/antigravity-codespaces
```

Tooltip:

```text
Repository: Nir-Bhay/antigravity-codespaces
```

Text rules:

- ellipsis overflow;
- never wrap into 3+ lines.

Recommended width strategy:

```css
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

---

# 22. Branch Metadata Row

Icon:

Git branch icon.

Content:

```text
main
```

or:

```text
feature/sidebar
```

or:

```text
v5.0-release
```

or:

```text
—
```

Branch text can use monospace.

Recommended:

```css
font-family: var(--vscode-editor-font-family), monospace;
```

Branch chip may use a subtle neutral background:

```text
[ main ]
```

---

# 23. Last Activity Row

Icon:

Clock.

Examples:

```text
Active just now
Active 42m ago
Active 3d ago
```

Tooltip:

```text
Last active
```

Relative time should be computed from actual activity timestamps.

Avoid overly frequent updates; minute-level updates are sufficient.

---

# 24. Idle Timeout Indicator

Shown only when RUNNING.

Icon:

Moon.

Text:

```text
Idle timeout: 30m
```

Tooltip:

```text
Auto-stops after 30m inactivity
```

Visual treatment:

- warm amber accent;
- subtle soft background;
- compact inline badge.

The purpose is cost awareness, not alarm.

Running codespaces incur compute usage, while stopped codespaces do not incur CPU charges; this supports making the stop action clearly available. citeturn136037search6turn136037search7

---

# 25. Action Dock

Each card has a bottom action row.

## Left: primary lifecycle actions

Running:

```text
[▶ Connect] [■ Stop]
```

Stopped:

```text
[▶ Start]
```

## Right: utility actions

```text
[⚡] [Globe] [Hammer] [Terminal] [Trash]
```

The approved reference shows all five utilities directly on desktop.

At narrow widths, these may collapse into an overflow menu if they can no longer maintain comfortable touch/click target sizes.

---

# 26. Connect Button

Label:

```text
Connect
```

Icon:

Play / connection-start symbol.

Tooltip:

```text
Connect in Antigravity IDE
```

Behavior:

1. If stopped:
   - initiate wake-up;
   - transition through starting state.
2. Resolve SSH host alias.
3. mount/open remote folder.
4. move user into connected IDE workspace.

The action should provide immediate visual feedback.

Suggested intermediate state:

```text
Connecting…
```

Disable duplicate activation while in progress.

---

# 27. Start Button

When stopped:

```text
▶ Start
```

Action:

Wake the Codespace using the REST endpoint / existing backend command.

Button is the primary action because the workspace is currently inactive.

---

# 28. Stop Button

When running:

```text
■ Stop
```

Tooltip:

```text
Stop Codespace (save hours)
```

The reference design gives Stop a red-tinted secondary treatment.

Do not use the full destructive modal flow for Stop because stopping is reversible.

Provide progress state:

```text
Stopping…
```

while waiting for the API.

---

# 29. Test SSH

Icon:

Lightning / Zap

Tooltip:

```text
Test SSH Tunnel Latency
```

Action:

- test SSH tunnel;
- measure latency;
- report milliseconds.

Success example:

```text
SSH tunnel healthy · 84 ms
```

Failure example:

```text
SSH test failed
```

A small toast is preferred over a permanent card expansion.

---

# 30. Open in Web

Icon:

Globe

Tooltip:

```text
Open in GitHub Web
```

Action:

Open:

```text
https://github.com/codespaces/<name>
```

Open external browser.

Do not render the full URL in the card.

---

# 31. Rebuild

Icon:

Hammer / build.

Tooltip:

```text
Rebuild DevContainer
```

Action:

Open rebuild choice dialog.

GitHub's Codespaces lifecycle supports rebuilding with cached layers by default and a full rebuild that clears cache and rebuilds fresh images. citeturn136037search6

---

# 32. Copy SSH

Icon:

Terminal prompt.

Tooltip:

```text
Copy SSH Command
```

Copied command format:

```bash
gh cs ssh -c <codespace-name>
```

After copy:

Toast:

```text
Copied: gh cs ssh -c <codespace-name>
```

Do not show the full command in the card at all times.

---

# 33. Delete

Icon:

Trash.

Tooltip:

```text
Delete Codespace
```

Visual treatment:

- red icon;
- red hover background;
- never make the entire card red.

Delete must always require confirmation.

GitHub warns that deleting is permanent and that users should consider unpushed work before deletion, so the confirmation flow should be treated as a high-consequence interaction. citeturn136037search6

---

# 34. Workspace Card Overflow Menu

Even though the approved desktop reference exposes utility buttons directly, provide a semantic overflow fallback.

Possible menu:

```text
Test SSH
Open in GitHub Web
Rebuild DevContainer
Copy SSH Command
Delete Codespace
```

Use it:

- on narrow layouts,
- on keyboard-driven layouts where discoverability is better,
- or when the direct action dock cannot maintain minimum target sizes.

This avoids forcing horizontal overflow.

---

# 35. Card Hover State

Hover should be subtle.

Recommended:

- border darkens slightly;
- shadow increases by a small amount;
- no scale transform;
- no card translation;
- action buttons become marginally clearer.

Never use:

```css
transform: scale(1.03);
```

for dashboard cards.

This is a developer control surface, not a gallery.

---

# 36. Card Focus State

Keyboard focus should be visibly obvious.

Recommended:

```css
outline:
  2px solid var(--hub-accent);
outline-offset: 2px;
```

Never rely on hover styling as focus indication.

---

# 37. Loading State

When data is initially being fetched:

### Page-level state

Keep header and page structure visible.

Skeleton:

```text
KPI skeletons
filter skeleton
4 × workspace skeletons
```

Do not flash the entire page to blank.

## Skeleton geometry

Match final content geometry closely:

- KPI skeleton: ~84 px tall
- card skeleton: ~200 px tall
- metadata lines: 12–14 px
- action row: ~32 px

Use reduced-motion-safe shimmer.

---

# 38. Empty Workspace State

Message:

```text
No Codespaces found. Click "New Codespace" to provision one.
```

## Layout

Center within the available content region.

Recommended structure:

```text
[Cloud / empty-state icon]

No Codespaces found.

Click "New Codespace" to provision one.

[+ New Codespace]
```

Do not use a giant illustration.

The visual weight should be substantially lower than the dashboard's loaded state.

---

# 39. Filtered Empty State

When search returns no matches:

```text
No Codespaces match your search.
```

Recommended secondary action:

```text
Clear search
```

Do not reuse the provisioning copy here because the user's Codespaces may exist.

---

# 40. Full-Page Error State

Title:

```text
Failed to load Cloud Hub
```

Details:

```text
<err.message>
```

Add:

```text
[Retry]
```

Layout:

```text
[Alert Icon]

Failed to load Cloud Hub

<err.message>

[Retry]
```

Use a restrained error panel rather than an alarming full-red page.

---

# 41. Toast System

Position:

```text
bottom: 16–20px
right: 16–20px
```

Width:

```text
min-width: 280px
max-width: 420px
```

Height:

Approximately 44–52 px.

Radius:

10–12 px.

### Copy SSH toast

```text
✓  Copied: gh cs ssh -c antigravity-codespaces
```

### Theme toast

```text
Switched to Light Mode
```

or:

```text
Switched to Dark Mode
```

Auto dismiss:

**3000 ms**

Keep a close button available if the toast becomes multi-line.

---

# 42. New Codespace Wizard

## Critical UX note

VS Code UX guidance explicitly recommends using webviews for custom functionality only when necessary and discourages using a webview itself for wizards. Therefore, if possible, implement the actual multi-step create flow using native VS Code Quick Picks / input prompts and use the dashboard webview primarily as the Cloud Hub management surface. citeturn136037search0turn136037search1

However, the approved visual reference includes wizard-like panels. If the product intentionally keeps the entire flow in the Webview, the visual and behavior spec below must be followed.

---

# 43. Create Wizard — Step 1

Title:

```text
Create New Codespace
```

Progress:

```text
Step 1 of 4
```

Prompt:

```text
Select GitHub account for new Codespace
```

Account rows:

```text
NI  Nir-Bhay     (Active)
OC  octocat
GH  github
```

Selection:

- radio control;
- full-row click;
- selected row uses subtle blue surface;
- selected account gets blue selection indicator.

Footer:

```text
[Cancel]                              [Next →]
```

---

# 44. Create Wizard — Step 2

Title:

```text
Select Repository
```

Progress:

```text
Step 2 of 4
```

Search:

```text
Search repositories...
```

Repository row:

```text
[repo icon] antigravity-codespaces         Private
[repo icon] markups                         Public
[repo icon] jobrizz                         Private
[repo icon] passman                         Public
```

Privacy badge:

```text
Private
Public
```

Manual option:

```text
✎ Enter repository manually...
```

---

# 45. Manual Repository Entry

Prompt:

```text
Enter owner/repo
```

Placeholder:

```text
owner/repo-name
```

Validation:

- owner required;
- `/` required;
- repository segment required;
- trim whitespace;
- prevent accidental duplicate slash.

Error example:

```text
Enter a repository in owner/repo format.
```

---

# 46. Create Wizard — Step 3

Title:

```text
Choose Branch
```

Prompt:

```text
Branch name (leave empty for default)
```

Input:

```text
main
```

Helper:

```text
If left empty, the default branch will be used.
```

Footer:

```text
[← Back]                              [Next →]
```

The branch field must not force a branch when default is intended.

---

# 47. Create Wizard — Step 4

Title:

```text
Provisioning
```

Progress:

```text
Step 4 of 4
```

Body:

```text
Creating Codespace on
Nir-Bhay/antigravity-codespaces
```

Progress bar:

- indeterminate until API provides a percentage;
- use blue.

Helper:

```text
This may take a few minutes...
```

Action:

```text
[Cancel]
```

Do not offer a misleading “Done” button while provisioning.

---

# 48. Rebuild Dialog

Title:

```text
Rebuild DevContainer
```

Prompt:

```text
Rebuild "antigravity-codespaces"?
```

Option A:

```text
Standard Rebuild
Uses layer cache (faster)
```

Icon:

Refresh / rebuild symbol.

Option B:

```text
Full Rebuild (no cache)
Clean container rebuild
```

Icon:

Trash / clean-build symbol.

Footer:

```text
[Cancel]
```

The primary option should be Standard Rebuild.

Full rebuild is a destructive-ish maintenance action and should be visually distinct.

---

# 49. Delete Confirmation

Title:

```text
Delete Codespace
```

Content:

```text
Delete "antigravity-codespaces"?
This is permanent and cannot be undone.
```

Recommended warning icon:

Trash in a soft red circular container.

Actions:

```text
[Cancel]      [Delete]
```

Delete button:

- filled danger red;
- 38–40 px height;
- minimum 96 px width.

Cancel:

- neutral outlined/secondary.

Do not place Delete as the first button.

---

# 50. Modal Layer

## Overlay

Use a translucent dark scrim:

```css
background: rgba(15, 23, 42, 0.28);
```

The underlying dashboard remains faintly visible.

## Modal width

Standard:

**460–560 px**

For repository selection:

**560–640 px**

For delete confirmation:

**420–480 px**

## Modal padding

```text
20–24 px
```

## Close button

Top-right:

```text
×
```

44 × 44 clickable area while keeping icon visually 16–18 px.

---

# 51. Grid / List Toggle

The generated reference shows:

```text
[Grid] [List]
```

Keep this control visually secondary.

Grid mode:

- active when workspace cards are shown.

List mode:

- compact table/list layout;
- same content and actions;
- not required for the base card design unless product implementation supports it.

Do not make it visually compete with account filters.

---

# 52. Account Chip Overflow

For many GitHub accounts:

At desktop:

```text
All | account | account | account | account
```

At narrow widths:

- chips become horizontally scrollable;
- scrollbar should be unobtrusive;
- first active chip remains visible.

Use:

```css
overflow-x: auto;
scrollbar-width: thin;
```

Do not wrap into multiple rows unless there is a strong product reason.

---

# 53. Responsive Header Behavior

## 1280+ px

Show:

```text
New Codespace
Sync SSH
Refresh
Theme
Avatar
```

## 900–1279 px

Recommended:

```text
New Codespace
Sync SSH
Refresh
Theme
Avatar
```

with reduced horizontal padding.

## 640–899 px

Use:

```text
[+ New Codespace]
[Sync]
[Refresh]
[Theme]
[Avatar]
```

## <640 px

Prefer:

```text
[+]
[↔]
[↻]
[Theme]
```

with accessible tooltips.

---

# 54. Responsive Workspace Cards

## Four-column desktop

Full card anatomy.

## Two-column tablet

Full card anatomy, no content loss.

## One-column mobile

Card becomes:

```text
title/status
account
repo
branch
activity
idle state
primary actions
utility overflow
```

The five utility icons may move into:

```text
[•••]
```

to preserve usable button sizes.

---

# 55. Minimum Interactive Target

Every interactive control should have a comfortable target.

Recommended:

**36 × 36 px minimum**

Preferred for touch-capable environments:

**40–44 px**

This is especially important for icon-only utility actions.

Do not make the visible icon itself 36 px. The clickable hit area can be 36–40 px with a 16–18 px glyph.

---

# 56. Icon System

## Preferred approach

Use the **VS Code Codicon / existing product icon system** wherever a matching icon exists.

VS Code UX guidance recommends using existing product icons when possible and limiting toolbar/icon clutter. citeturn136037search2turn136037search4

## Icon characteristics

- 16 px standard toolbar icon.
- 14 px compact utility icon.
- 18–20 px hero/context icon.
- 1.5–2 px apparent stroke weight depending on icon source.
- no emoji icons.
- no random icon packs mixed together.

---

# 57. Recommended Icon Mapping

| Purpose | Recommended visual icon | Preferred Codicon-style name / fallback |
|---|---|---|
| Cloud Hub | cloud | `cloud` |
| Dashboard | layout grid | `layout-dashboard` / `layout` fallback |
| New | plus | `add` |
| Refresh | rotating arrows | `refresh` |
| Sync SSH | sync | `sync` |
| Theme light | sun | `sun` |
| Theme dark | moon | `moon` |
| Account | person | `account` |
| Settings | gear | `settings-gear` |
| Server KPI | server/database | `server` |
| Running KPI | power | `power` |
| Stopped KPI | clock | `history` / clock fallback |
| Storage | shield | `shield` |
| Search | magnifier | `search` |
| Grid view | four squares | `gripper` / grid fallback |
| List view | list | `list-unordered` |
| Running status | dot | CSS circle |
| Repository | repo/book | `repo` |
| Branch | Git branch | `git-branch` |
| Last activity | clock | `history` / clock |
| Idle timeout | moon | `moon` |
| Connect | play | `play` |
| Stop | square | `debug-stop` / stop |
| Start | power/play | `play` or `power` |
| Test SSH | lightning | `zap` / `debug` fallback |
| Web | globe | `globe` |
| Rebuild | hammer/build | `tools` / `debug-restart` fallback |
| Copy SSH | terminal | `terminal` |
| Delete | trash | `trash` |
| Warning | triangle | `warning` |
| Error | circle alert | `error` |
| Success | check | `check` |
| Next | arrow right | `chevron-right` |
| Back | arrow left | `chevron-left` |
| Dropdown | chevron | `chevron-down` |
| Close | X | `close` |
| External link | outbound | `link-external` |

**Important:** Verify the exact icon identifier against the project's installed Codicon package instead of assuming every friendly name maps one-to-one.

---

# 58. SVG Rules

Custom SVG should be limited to:

1. product cloud logo;
2. any unique empty-state illustration that is part of the product identity.

For ordinary interface actions:

- prefer Codicon or the project's existing icon package.

SVG requirements:

```text
viewBox          fixed and normalized
fill/stroke      currentColor where practical
width            1em
height           1em
pointer-events  none
aria-hidden      true when paired with visible text
```

Example wrapper:

```html
<button type="button" aria-label="Refresh">
  <svg aria-hidden="true">...</svg>
</button>
```

---

# 59. Data Model → UI Mapping

Suggested normalized object:

```ts
type CodespaceViewModel = {
  id: string;
  name: string;
  displayName?: string;

  account: {
    login: string;
    avatarUrl?: string;
    authMethod?: "oauth" | "pat" | "cli";
  };

  repository: {
    fullName: string;
    visibility?: "public" | "private";
  };

  branch?: {
    ref?: string;
  };

  state:
    | "Available"
    | "Stopped"
    | "Starting"
    | "Stopping"
    | "Failed";

  lastActiveAt?: string;

  idleTimeoutMinutes?: number;

  ssh?: {
    hostAlias?: string;
    latencyMs?: number;
    healthy?: boolean;
  };

  ports?: Array<{
    sourcePort: number;
    visibility: "private" | "org" | "public";
    browseUrl?: string;
  }>;
};
```

The UI layer should consume a normalized view model rather than coupling JSX directly to raw GitHub API objects.

---

# 60. UI State Machine

## Workspace status states

```text
Stopped
   │
   ├── Start → Starting
   │             │
   │             ├── success → Running
   │             └── failure → Stopped + error
   │
Running
   │
   ├── Stop → Stopping
   │             │
   │             ├── success → Stopped
   │             └── failure → Running + error
   │
   ├── Connect → Connecting
   │                │
   │                ├── success → Connected
   │                └── failure → Running + error
   │
   └── Rebuild → Rebuilding
                  │
                  ├── success → Running
                  └── failure → Running + error
```

Do not let users activate Start/Stop/Connect multiple times during transitional states.

---

# 61. Specific Loading States

## Connect

Button:

```text
Connecting…
```

Icon:

spinner or progress indication.

## Start

Button:

```text
Starting…
```

## Stop

Button:

```text
Stopping…
```

## Rebuild

Modal:

```text
Rebuilding…
```

## Sync SSH

Header button:

```text
Syncing…
```

## Refresh

Header button:

```text
Refreshing…
```

---

# 62. Error Messaging Rules

Error messages must answer:

1. What failed?
2. What can the user do now?

Examples:

Bad:

```text
Error 403
```

Better:

```text
Failed to start Codespace.
GitHub rejected the request.

[Retry]
```

Better for SSH:

```text
SSH tunnel test failed.
Check GitHub CLI and SSH configuration.

[Retry]
```

Do not expose raw stack traces in the primary UI.

A detailed error may be available through a diagnostic detail action.

---

# 63. Tooltip Rules

Tooltips are required for icon-only controls.

Tooltip examples:

```text
Toggle Dark / Light Theme
Test SSH Tunnel Latency
Open in GitHub Web
Rebuild DevContainer
Copy SSH Command
Delete Codespace
```

Tooltip behavior:

- delay ~500 ms;
- escape accessible;
- never obscure the control action permanently;
- use `aria-label` even if a tooltip exists.

---

# 64. Keyboard Navigation

Required:

### `/`
Focus search.

### `Esc`
Search:
- clear and unfocus.

Modal:
- close only when safe and not during destructive in-flight operation.

### `Tab`
Logical order:

```text
header actions
account filters
search
view toggle
workspace cards
card actions
```

### `Enter` / `Space`
Activate buttons, filters, and selectable rows.

### Arrow keys
Optional for account chip group and wizard selection.

---

# 65. Accessibility

The Webview should follow VS Code's accessibility guidance.

The Webview environment exposes theme classes and variables, and adds classes for screen-reader and reduced-motion contexts. Use these capabilities rather than building a visually isolated accessibility system. citeturn136037search1

Required:

- semantic buttons instead of clickable `<div>`;
- `<input>` with labels or aria-label;
- visible focus states;
- `aria-live` for async status and toast announcements;
- status badges should not rely on color alone;
- delete warnings must have meaningful text;
- modal focus trap;
- restore focus to the triggering control after modal close;
- disabled controls must not look like active controls.

---

# 66. VS Code Theme Integration

The design should support:

1. light;
2. dark;
3. high contrast.

VS Code webviews expose `vscode-light`, `vscode-dark`, and `vscode-high-contrast` classes plus `--vscode-*` theme variables. citeturn136037search1

Recommended variable bridge:

```css
:root {
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}

.hub-card {
  background:
    var(--vscode-editorWidget-background);
  border-color:
    var(--vscode-editorWidget-border);
}
```

Where product-specific visual tokens are necessary, derive them from VS Code theme variables whenever possible.

Do not hard-code white/black in a way that breaks dark mode.

---

# 67. Reduced Motion

When the host adds:

```text
vscode-reduce-motion
```

disable:

- running radar pulse;
- skeleton shimmer;
- button icon spinning except where the motion is required to communicate active progress.

Use opacity changes and static states instead.

---

# 68. High Contrast Mode

Do not rely solely on:

- border subtlety,
- faint background shifts,
- color-only state.

Increase:

- border contrast;
- focus ring;
- text contrast;
- selected-state indicator.

---

# 69. Dashboard Vertical Rhythm

Target rhythm from top to bottom:

```text
Page padding top                 18 px
Header                           ~52 px
Gap after header                 14–16 px
KPI row                           84–90 px
Gap                               14–16 px
Filter/search row                 40–42 px
Gap                               12–14 px
Workspace cards                   ~200 px
Card row gap                      12 px
```

The dashboard should feel compact but not cramped.

---

# 70. Horizontal Rhythm

Desktop main area:

```text
left page inset:       18–20 px
right page inset:      18–20 px
card-to-card gap:      12 px
section gap:           14–18 px
button gap:             6–8 px
metadata icon gap:      7–9 px
```

Avoid arbitrary 24/32/40 px gaps everywhere; the approved design relies on a tighter 6/8/12/16 rhythm.

---

# 71. Card Internal Spacing

Suggested:

```text
status row → account row:          5–7 px
account → repository:              10–12 px
repository → branch:                7 px
branch → activity:                  7 px
activity → action dock:             11–12 px
```

The card should not have a large dead center region.

---

# 72. Card Action Dimensions

Primary button:

```text
height: 32 px
padding: 0 12 px
radius: 8 px
icon: 14 px
```

Utility icon:

```text
32 × 32 px clickable box
16 px glyph
radius: 7–8 px
```

Delete:

- same size as utilities;
- red glyph;
- danger hover.

---

# 73. Repository and Branch Truncation

Repository path:

```text
Nir-Bhay/antigravity-codespaces
```

may overflow.

Use:

```css
min-width: 0;
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

Always preserve tooltip/full accessible label.

Branch may also truncate if extremely long.

---

# 74. Account Avatar Fallbacks

Priority:

1. GitHub avatar URL.
2. Account initials.
3. Generic account icon.

Initials:

```text
Nir-Bhay → NI
octocat  → OC
github   → GH
```

Use only 1–2 characters.

---

# 75. Account Ownership Color

Account chips can receive subtle per-account avatar colors.

Do not assign aggressive random colors to cards.

Identity colors should be low-saturation and remain accessible.

---

# 76. View Mode Toggle

The reference includes a grid/list toggle.

## Grid active

Displays current bento/card layout.

## List active

Recommended row:

```text
status | workspace | account | repository | branch | last activity | state | actions
```

Keep list mode as a future-ready component.

Do not create a completely unrelated visual design for list view.

---

# 77. Search Debouncing

Recommended:

- local filtering: immediate;
- remote search: 150–250 ms debounce.

For the supplied dashboard behavior, filtering local loaded Codespaces should feel instantaneous.

---

# 78. Refresh Behavior

When user clicks Refresh:

1. Show icon rotation.
2. Invalidate local cache.
3. Fetch latest status from all linked accounts.
4. Preserve current search text.
5. Preserve current account filter.
6. Preserve current view mode.
7. Re-render without jumping scroll position unnecessarily.

Do not reset the user's filter just because data was refreshed.

---

# 79. Sync SSH Behavior

When clicking Sync SSH:

1. Start busy state.
2. Generate ProxyCommand blocks for all available Codespaces.
3. Write/update `~/.ssh/config`.
4. Report success.

Success toast:

```text
SSH config synced
```

Failure:

```text
Failed to sync SSH configuration.
```

Do not block the entire dashboard while this runs.

---

# 80. Theme Toggle Behavior

Toggle:

```text
Light → Dark
Dark → Light
```

Toast:

```text
Switched to Light Mode
```

or:

```text
Switched to Dark Mode
```

Persist preference if the product already has a configuration store.

The screenshot's sun/moon button is intentionally compact; preserve it as an icon-only control.

---

# 81. Empty Accounts State

If no GitHub accounts are linked, the dashboard should not show an empty Codespace grid without context.

Recommended empty state:

```text
Connect a GitHub account to manage Codespaces.

[Add GitHub Account]
```

This is logically distinct from:

```text
No Codespaces found.
```

because the latter assumes an authenticated account context.

---

# 82. Account Filtering Semantics

Default:

```text
All Accounts
```

Selected account:

- only that account's workspaces appear.

Counts:

- All = all visible workspaces.
- Account = workspaces belonging to that account.

Do not update chip counts from the search query; counts should represent underlying workspace counts unless product requirements explicitly change that behavior.

---

# 83. Search + Account Filter Combination

Filters are cumulative.

Example:

```text
Account = Nir-Bhay
Search = main
```

means:

```text
Only Nir-Bhay Codespaces where name/repository/branch matches "main".
```

Clearing search must not clear account filter.

Clearing account filter must not clear search.

---

# 84. Provisioning Completion

After Codespace creation succeeds:

1. Close provisioning state.
2. Refresh the dashboard data.
3. Select or highlight the newly created Codespace.
4. Optionally show:

```text
Codespace created successfully
```

5. Do not automatically connect unless the supplied flow explicitly chooses to do so.

---

# 85. Rebuild Completion

On success:

```text
Rebuild complete
```

The card status should return to its actual backend state.

Do not assume the container is fully healthy just because the rebuild API returned successfully.

---

# 86. Delete Completion

After confirmed deletion:

1. Close modal.
2. Remove card optimistically only if backend confirms.
3. Refresh counters.
4. If no cards remain:

```text
No Codespaces found. Click "New Codespace" to provision one.
```

---

# 87. Optimistic UI Rules

Use optimistic updates only where failure can be cleanly reverted.

Good candidates:

- local search/filter.
- selected account.
- theme.

Be conservative with:

- Start.
- Stop.
- Rebuild.
- Delete.

For cloud lifecycle actions, prefer server-confirmed state.

---

# 88. Network Failure During Action

Example:

User clicks Start.

UI:

```text
Starting…
```

If API fails:

```text
Failed to start "jobrizz-dev".
```

Restore:

```text
Start
```

Do not leave the card in an ambiguous “loading” state.

---

# 89. Browser/External Link Safety

For:

```text
Open in GitHub Web
```

use the host's external URL mechanism rather than relying on a raw anchor if the extension already has a command handler.

Validate the generated URL before opening.

---

# 90. Information Density Rules

The dashboard should maintain these priorities:

### Highest priority

- workspace name;
- running/stopped status;
- Connect / Start / Stop.

### Medium priority

- account;
- repository;
- branch;
- last activity.

### Secondary

- idle timeout;
- SSH;
- rebuild;
- web;
- copy;
- delete.

Do not allow secondary controls to visually dominate the primary lifecycle actions.

---

# 91. Visual Hierarchy in Cards

Recommended order:

```text
1. Status + workspace name
2. Account
3. Repository
4. Branch
5. Activity / idle timeout
6. Primary actions
7. Utility actions
```

This same hierarchy must remain intact in responsive variants.

---

# 92. Bento Card Styling

The generated reference uses a very restrained bento-card look.

Characteristics:

- white surface;
- light border;
- compact radius;
- minimal shadow;
- subtle internal alignment;
- no oversized gradients;
- no decorative illustration;
- no glass blur;
- no exaggerated hover animation.

Running cards may receive a faint green-tinted contextual background or status treatment, but the content must remain primarily white.

---

# 93. Running vs Stopped Card Difference

Running cards:

- green status dot;
- RUNNING pill;
- idle timeout;
- Connect + Stop;
- slightly warmer contextual accent.

Stopped cards:

- gray status dot;
- STOPPED pill;
- Start as primary;
- no idle timeout.

The state must remain obvious when viewed at a glance.

---

# 94. Dashboard Scroll Behavior

Main page:

```css
overflow-y: auto;
overflow-x: hidden;
```

Navigation:

- independently scrollable only if needed.

Sticky header:

Optional, but recommended only if the dashboard becomes vertically long.

If using sticky header:

- keep it visually lightweight;
- do not create a second heavy card-like surface.

---

# 95. Modal Scroll Behavior

Modal body:

```css
max-height: min(70vh, 680px);
overflow-y: auto;
```

Modal footer:

Keep visible where practical.

For repository lists, only the list area should scroll.

---

# 96. Z-Index Layers

Suggested:

```text
base dashboard:     0
sticky header:      10
popover/dropdown:   100
toast:              500
modal scrim:        900
modal:              1000
```

Avoid excessive arbitrary z-index values.

---

# 97. Component Architecture

Suggested React structure:

```text
CloudHubPage
├── AppShell
│   ├── Sidebar
│   └── MainContent
│       ├── CloudHubHeader
│       ├── MetricsGrid
│       │   └── MetricCard
│       ├── WorkspaceToolbar
│       │   ├── AccountFilterChips
│       │   ├── SearchInput
│       │   └── ViewModeToggle
│       ├── WorkspaceGrid
│       │   └── WorkspaceCard
│       │       ├── WorkspaceHeader
│       │       ├── WorkspaceMetadata
│       │       ├── WorkspaceActivity
│       │       └── WorkspaceActions
│       └── StateLayer
│           ├── LoadingState
│           ├── EmptyState
│           └── ErrorState
├── CreateCodespaceWizard
├── RebuildDialog
├── DeleteConfirmation
└── ToastHost
```

---

# 98. Recommended Hook/State Separation

Suggested:

```text
useCloudHubData()
useAccounts()
useCodespaces()
useWorkspaceFilters()
useTheme()
useToast()
useModal()
useProvisioning()
```

Do not keep all state inside one giant component.

---

# 99. Webview Messaging Contract

Recommended message pattern:

```ts
type WebviewMessage =
  | { command: "refresh" }
  | { command: "syncSsh" }
  | { command: "createCodespace"; payload: CreatePayload }
  | { command: "connect"; codespaceId: string }
  | { command: "start"; codespaceId: string }
  | { command: "stop"; codespaceId: string }
  | { command: "testSsh"; codespaceId: string }
  | { command: "openWeb"; codespaceId: string }
  | { command: "rebuild"; codespaceId: string; mode: "standard" | "full" }
  | { command: "copySsh"; codespaceId: string }
  | { command: "delete"; codespaceId: string };
```

The Webview should request actions; the extension host should own privileged operations.

---

# 100. Security Boundary

Never expose secrets directly into DOM.

Especially:

- PAT;
- GitHub OAuth tokens;
- SSH credentials;
- raw environment secrets.

The Webview should receive only the minimum data required to render the UI.

---

# 101. Performance

Because this is an IDE extension, avoid unnecessary Webview cost.

VS Code describes webviews as powerful but resource-heavy and recommends using them sparingly. citeturn136037search1

Recommended:

- memoize workspace cards;
- avoid rerendering every card on hover;
- virtualize only when workspace counts become genuinely large;
- lazy-render modal content;
- avoid giant client-side libraries for simple interactions;
- use CSS animations rather than JS loops.

---

# 102. Recommended Large-List Threshold

For:

```text
<= 30 codespaces
```

normal CSS Grid rendering is fine.

For:

```text
30–100
```

optimize with memoization and stable keys.

For:

```text
100+
```

consider virtualization.

Do not add virtualization just because it is possible.

---

# 103. Reference Screen-to-Component Mapping

| Reference area | Implementation component |
|---|---|
| Left white rail | `Sidebar` |
| Cloud icon + title | `CloudHubHeader` |
| New Codespace | `PrimaryButton` |
| Sync SSH | `SecondaryButton` |
| Refresh | `IconButton` / button |
| Theme | `ThemeToggle` |
| Avatar | `AccountAvatar` |
| 4 top metrics | `MetricsGrid` |
| Account chips | `AccountFilterChips` |
| Search | `SearchInput` |
| Grid/list | `ViewModeToggle` |
| Workspace panels | `WorkspaceCard` |
| Card action dock | `WorkspaceActions` |
| Empty center | `EmptyState` |
| Error center | `ErrorState` |
| Wizard | `CreateCodespaceWizard` |
| Rebuild | `RebuildDialog` |
| Delete | `DeleteConfirmation` |
| Toast | `ToastHost` |

---

# 104. Exact Text Inventory

Use these strings exactly unless backend data is injected.

## Header

```text
Antigravity Codespaces Cloud Hub
Multi-Account Cloud Workspace Director · Enterprise Edition
New Codespace
Sync SSH
Refresh
Toggle Dark / Light Theme
```

## KPI

```text
TOTAL WORKSPACES
RUNNING INSTANCES
STOPPED (SAVED)
STORAGE TIER
15 GB Free Tier
```

## Filters

```text
ALL
All Accounts
Search by name, repository, branch... (Press / to focus)
```

## Card

```text
RUNNING
STOPPED
Connect
Stop
Start
Idle timeout: <minutes>m
Active <relative_time>
```

## Tooltips

```text
Connect in Antigravity IDE
Stop Codespace (save hours)
Turn ON Codespace
Test SSH Tunnel Latency
Open in GitHub Web
Rebuild DevContainer
Copy SSH Command
Delete Codespace
```

## Empty

```text
No Codespaces found. Click "New Codespace" to provision one.
```

## Error

```text
Failed to load Cloud Hub
<err.message>
Retry
```

## Create flow

```text
Create New Codespace
Select GitHub account for new Codespace
Select Repository
Search repositories...
Enter repository manually...
Enter owner/repo
owner/repo-name
Choose Branch
Branch name (leave empty for default)
main
If left empty, the default branch will be used.
Provisioning
Creating Codespace on <owner/repo>...
This may take a few minutes...
```

## Rebuild

```text
Rebuild DevContainer
Rebuild "<codespace_name>"?
Standard Rebuild
Uses layer cache (faster)
Full Rebuild (no cache)
Clean container rebuild
```

## Delete

```text
Delete Codespace
Delete "<codespace_name>"?
This is permanent and cannot be undone.
Delete
Cancel
```

## Toasts

```text
Copied: gh cs ssh -c <codespace-name>
Switched to Light Mode
Switched to Dark Mode
```

---

# 105. Sample Content Mapping

Use the reference examples only as visual content examples; real data must come from the extension.

```text
antigravity-codespaces
Nir-Bhay
Nir-Bhay/antigravity-codespaces
main
Active 12m ago
Idle timeout: 30m
RUNNING
```

```text
markups
Nir-Bhay
Nir-Bhay/markups
main
Active just now
Idle timeout: 30m
RUNNING
```

```text
jobrizz-dev
Nir-Bhay
Nir-Bhay/jobrizz
feature/sidebar
Active 3h ago
STOPPED
```

```text
passman
Nir-Bhay
Nir-Bhay/passman
dev
Active 2d ago
STOPPED
```

These names are reference data only; never hard-code them into production.

---

# 106. Empty State Icon

The reference uses a minimal cloud/browser-style illustration.

If implemented as custom SVG:

- use a simple line/flat style;
- no gradients;
- no complex isometric art;
- no more than 2–3 major shapes;
- muted neutral treatment.

Purpose:

- communicate absence;
- not advertise the product.

---

# 107. Error Icon

Use:

```text
circle with alert / exclamation
```

Recommended:

- 18–20 px;
- danger tint;
- soft danger background.

---

# 108. Success Icon

Use:

```text
check / check-circle
```

Toast:

```text
green check
```

No confetti.

No oversized animation.

---

# 109. Dialog Transition

Recommended:

```text
overlay: 120–180 ms opacity
modal:   150–200 ms ease-out
```

Start:

```css
opacity: 0;
transform: translateY(4px) scale(.99);
```

End:

```css
opacity: 1;
transform: translateY(0) scale(1);
```

Disable under reduced motion.

---

# 110. Buttons: State Matrix

| Button | Idle | Hover | Active | Disabled | Loading |
|---|---|---|---|---|---|
| New Codespace | blue | darker blue | pressed | muted | Creating… |
| Connect | blue | darker | pressed | muted | Connecting… |
| Start | green | darker | pressed | muted | Starting… |
| Stop | red-tinted | stronger red | pressed | muted | Stopping… |
| Secondary | outlined | tinted | pressed | muted | action text |
| Delete | danger | darker | pressed | muted | Deleting… |

Never remove text during loading if doing so causes layout shift.

---

# 111. Avoiding Layout Shift

Important:

- reserve space for status badge;
- fixed-height action dock;
- fixed KPI height;
- don't add a new line when a card becomes running/stopped;
- reserve search shortcut key area;
- modal option rows remain same height between states.

---

# 112. Content Overflow Rules

Long workspace name:

```text
2-line clamp
```

Long repository:

```text
single-line ellipsis
```

Long branch:

```text
single-line ellipsis
```

Long error:

```text
wrap within modal/panel
```

Never allow long technical identifiers to create horizontal scrolling in the main page.

---

# 113. Developer-Focused Microcopy

The supplied content should remain direct.

Prefer:

```text
Starting…
Stopping…
Refreshing…
Rebuilding…
Deleting…
```

Avoid marketing language such as:

```text
Let's supercharge your environment!
```

The product is a developer tool.

---

# 114. Native VS Code Alignment

Because this is a VS Code-style Webview:

- use VS Code theme tokens;
- keep controls visually compatible with the host;
- use product icons where possible;
- use command actions for extension operations;
- don't compete with the editor shell.

VS Code's current UX guidance favors existing product icons, clear View Actions, minimal toolbar clutter, and context-appropriate controls. citeturn136037search2turn136037search3turn136037search4

---

# 115. GitHub Codespaces Semantics Alignment

The dashboard's lifecycle language should align with actual Codespaces behavior:

- Start / Stop are reversible lifecycle actions.
- Running environments consume compute resources.
- Stopped environments preserve saved changes and do not incur CPU charges.
- Rebuild uses cache by default, with a full rebuild available.
- Delete is permanent and should be confirmed.
- Forwarded ports can provide browser-accessible endpoints.

These semantics are documented by GitHub. citeturn136037search6turn136037search7turn136037search8

---

# 116. Recommended Implementation Order

Do not implement all visual details at once.

## Phase 1 — Shell

Build:

```text
AppShell
Sidebar
Header
Main content
```

## Phase 2 — Data summary

Build:

```text
MetricsGrid
AccountFilterChips
Search
```

## Phase 3 — Core workspaces

Build:

```text
WorkspaceGrid
WorkspaceCard
WorkspaceActions
```

## Phase 4 — Lifecycle states

Implement:

```text
Start
Stop
Connect
Loading
Errors
```

## Phase 5 — Management actions

Implement:

```text
SSH
Web
Rebuild
Copy
Delete
```

## Phase 6 — Create flow

Implement:

```text
Account
Repository
Branch
Provisioning
```

## Phase 7 — Accessibility + themes

Test:

```text
Light
Dark
High Contrast
Reduced Motion
Keyboard
Screen reader
```

## Phase 8 — Responsive

Test all breakpoint classes.

---

# 117. Pixel-Precision QA Checklist

## Shell

- [ ] sidebar width matches target;
- [ ] main page inset is consistent;
- [ ] header groups align vertically;
- [ ] page title baseline is correct;
- [ ] action group does not wrap unexpectedly.

## KPI

- [ ] all four cards have identical height;
- [ ] icon wrapper sizes match;
- [ ] metric number alignment matches;
- [ ] label spacing is consistent.

## Toolbar

- [ ] account chips align vertically with search;
- [ ] active chip is obvious;
- [ ] search height matches chip height;
- [ ] `/` keycap sits inside input correctly.

## Workspace cards

- [ ] all cards have equal visual height;
- [ ] title baseline aligns;
- [ ] status pill sits consistently;
- [ ] account row uses same offset;
- [ ] repo and branch rows use same icon width;
- [ ] action dock aligns at card bottom;
- [ ] utility controls are evenly spaced.

## Responsive

- [ ] no horizontal overflow;
- [ ] cards become 2 columns when appropriate;
- [ ] cards become 1 column on mobile;
- [ ] navigation collapses;
- [ ] header actions compress;
- [ ] utility actions remain reachable.

## Modals

- [ ] overlay covers viewport;
- [ ] modal centered;
- [ ] modal footer remains visible;
- [ ] focus trapped;
- [ ] Escape behaves correctly.

## Toast

- [ ] fixed bottom-right;
- [ ] does not cover essential card actions;
- [ ] dismisses after approximately 3 seconds;
- [ ] supports multiple toast messages without layout break.

---

# 118. Visual Regression Checklist

Capture snapshots at:

```text
1536 × 1024
1440 × 900
1280 × 800
1024 × 768
900 × 700
768 × 1024
640 × 800
480 × 800
390 × 844
```

Compare:

1. left rail;
2. header;
3. KPI geometry;
4. filter row;
5. first visible card;
6. grid column count;
7. card action dock;
8. empty/error states;
9. modal centering;
10. toast position.

---

# 119. Reference Geometry Summary

The following are the primary target values for the approved desktop composition.

```text
Reference viewport           1536 × 1024

Sidebar                      ~220 px
Main horizontal padding      ~18–20 px
Header height                ~52–56 px
KPI height                   ~84–90 px
Toolbar control height       ~40–42 px
Workspace card height        ~195–210 px
Card radius                  ~10–12 px
Card gap                     ~12 px
Major section gap            ~14–18 px
Primary button height        ~32–40 px
Utility button               ~32 × 32 px
Icon standard                16 px
Large context icon           20–22 px
Avatar                        20–32 px
Toast margin                 ~16–20 px
Modal width                  ~420–640 px
```

These are **design targets inferred from the approved visual**, not measurements extracted from a production DOM.

---

# 120. What Must Not Change

Do not replace the core visual language with:

- huge dashboard charts;
- dark neon cyberpunk styling;
- glassmorphism;
- oversized gradients;
- giant hero illustrations;
- dense spreadsheet tables;
- excessive rounded pills;
- animated card scaling;
- emoji-based icons;
- multiple unrelated icon libraries;
- huge empty whitespace;
- marketing copy.

The product is a practical cloud workspace controller.

---

# 121. Final Agent Directive

When implementing this UI:

> Recreate the approved Antigravity Codespaces Cloud Hub reference as a production-ready, responsive VS Code/Antigravity Webview. Preserve the supplied information architecture and content. Use the visual geometry, spacing, typography, card density, button hierarchy, state colors, icon proportions, sidebar dimensions, responsive behavior, modal composition, toast positioning, and status semantics defined in this document. Use existing VS Code/Codicon icons wherever possible and custom SVG only for the product cloud mark or a deliberately designed empty-state illustration. Do not invent new dashboard sections or replace the supplied text with marketing copy. All lifecycle operations must expose immediate feedback and deterministic loading/error states. Build reusable React components and a normalized Codespace view model. Ensure keyboard navigation, accessible labels, focus management, screen-reader support, reduced-motion handling, high-contrast compatibility, and light/dark theme compatibility. Test the UI at the listed viewport sizes and maintain zero horizontal overflow. The 1536 × 1024 reference composition is the primary visual target.

---

# 122. Definition of Done

The dashboard is complete only when:

### Visual
- [ ] desktop reference looks extremely close to approved screenshot;
- [ ] spacing and typography are consistent;
- [ ] card grid has correct density;
- [ ] icons follow one coherent system.

### Functional
- [ ] search works;
- [ ] `/` focus shortcut works;
- [ ] Escape clears search;
- [ ] account filtering works;
- [ ] Start works;
- [ ] Stop works;
- [ ] Connect works;
- [ ] Test SSH works;
- [ ] Open in Web works;
- [ ] Rebuild works;
- [ ] Copy SSH works;
- [ ] Delete confirms;
- [ ] New Codespace flow works;
- [ ] Refresh works;
- [ ] Sync SSH works;
- [ ] theme toggle works.

### State handling
- [ ] loading;
- [ ] starting;
- [ ] stopping;
- [ ] connecting;
- [ ] rebuilding;
- [ ] provisioning;
- [ ] deleting;
- [ ] empty;
- [ ] filtered-empty;
- [ ] error;
- [ ] success toast.

### Responsive
- [ ] 1536 desktop;
- [ ] 1280 desktop;
- [ ] 1024 tablet;
- [ ] 768 tablet;
- [ ] 640 compact;
- [ ] 480 mobile;
- [ ] 390 mobile.

### Accessibility
- [ ] keyboard usable;
- [ ] visible focus;
- [ ] semantic buttons;
- [ ] modal focus trap;
- [ ] screen reader labels;
- [ ] high contrast;
- [ ] reduced motion;
- [ ] color is not the only state indicator.

---

# 123. Official Reference Notes

This specification intentionally keeps the supplied product content as the source of truth and uses current platform documentation only to validate implementation principles and lifecycle semantics.

### VS Code Webviews
VS Code states that Webviews are fully customizable but should be used only when necessary, should be themeable, and should follow accessibility guidance. It also exposes theme variables, screen-reader context, and reduced-motion context for Webview applications.  
Source: citeturn136037search0turn136037search1

### VS Code Views / Sidebars
VS Code recommends using existing product icons, keeping the number of Views limited, and avoiding excessive toolbar actions.  
Sources: citeturn136037search2turn136037search3turn136037search4

### GitHub Codespaces lifecycle
GitHub documents create, start, stop, rebuild, delete, and connection lifecycle behavior. Running Codespaces incur compute charges, while stopped Codespaces do not incur CPU charges. Standard rebuilds can reuse cache; full rebuilds clear the cache.  
Source: citeturn136037search6turn136037search7

### Forwarded Ports
GitHub documents forwarded ports and browser-accessible URLs for applications running in a Codespace.  
Source: citeturn136037search8

---

# 124. Final Design Intent

The final interface should communicate, within roughly two seconds:

```text
I am looking at all my cloud workspaces.
I know which GitHub account owns each one.
I can see what is running.
I can see what is stopped.
I can connect immediately.
I can stop unused environments.
I can create a new workspace.
I can manage SSH and browser access.
I can rebuild when needed.
I can safely delete with confirmation.
```

The visual language should remain:

**clean · technical · calm · dense · native-feeling · responsive · action-oriented**

The most important rule is simple:

> **Information first. Actions second. Decoration last.**