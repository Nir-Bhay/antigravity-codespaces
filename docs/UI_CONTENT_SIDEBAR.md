# Extension Sidebar: Complete UI Content & Interaction Specification

> **Purpose**: Pure structural, functional, and textual specification of everything displayed and interactive in the VS Code / Antigravity IDE extension sidebar.
> **Note**: This document intentionally excludes themes, CSS colors, styling, and visual decoration. Use this raw blueprint to construct any new design.

---

## 1. Extension Container & Header (VS Code Activity Bar & Sidebar Header)

### 1.1 Activity Bar Icon & Title
- **Activity Bar Icon**: Cloud icon (`icon.svg` / cloud glyph)
- **Container Title**: `Codespaces`
- **Sidebar View Title**: `GitHub Codespaces`

### 1.2 Sidebar Title Bar Quick Actions (Top Right of View Header)
Four primary actions sit in the native sidebar title toolbar:
1. **Open Cloud Hub Dashboard**
   - Icon / Glyph: `layout-sidebar-left`
   - Tooltip: `Open Cloud Hub Dashboard`
   - Action: Opens full-tab management dashboard.
2. **Create New Codespace**
   - Icon / Glyph: `plus`
   - Tooltip: `Create New Codespace`
   - Action: Triggers repository selection & creation flow.
3. **Switch GitHub Account**
   - Icon / Glyph: `account`
   - Tooltip: `Switch GitHub Account`
   - Action: Opens account switcher dropdown / quickpick.
4. **Refresh**
   - Icon / Glyph: `refresh`
   - Tooltip: `Refresh`
   - Action: Clears local cache and fetches latest cloud status.

---

## 2. State A: Unauthenticated / Welcome Screen (When No Account Is Linked)

When no GitHub account (OAuth, PAT, or CLI) is discovered:

### 2.1 Hero Callout
- **Hero Icon**: Cloud icon
- **Headline**: `Antigravity Codespaces`
- **Quota Badge / Pill**: `60 free compute hrs / month`
- **Description Copy**: `Connect, launch, and manage full cloud developer containers directly inside Antigravity IDE.`

### 2.2 Authentication Buttons & Actions
- **Primary Button**:
  - Icon: User profile icon
  - Label: `Sign In with GitHub`
  - Action: Launches zero-friction native GitHub OAuth authentication.
- **Secondary Button**:
  - Icon: Shield icon
  - Label: `Use Personal Access Token (PAT)`
  - Action: Prompts for token (`ghp_...` or `github_pat_...`) with secure storage in secret storage.
- **Sign Up Link**:
  - Text: `Don't have an account? Create one free →`
  - Target URL: `https://github.com/signup` (opens default external browser)

### 2.3 Diagnostic Checklist ("System Health Checklist")
A prerequisite inspection box showing environment readiness:
- **Section Heading**: `System Health Checklist`
- **Item 1**:
  - Label: `GitHub CLI (SSH Tunnels):`
  - Values: `Installed` (passing) OR `Missing` (warning)
- **Item 2**:
  - Label: `OpenSSH Client:`
  - Values: `Available` (passing) OR `Missing` (warning)
- **Item 3**:
  - Label: `Remote SSH Extension:`
  - Values: `Detected` (passing) OR `Recommended` (warning)
- **Conditional Call-to-Action Link** (displayed only if GitHub CLI is Missing):
  - Text: `Install GitHub CLI →`
  - Action: Offers OS-specific one-click installer (`winget`, `brew`, or download website).

---

## 3. State B: Authenticated Sidebar (Main View)

When at least one GitHub account is linked:

### 3.1 Top Account Bar
- **Account Identity**:
  - Icon: User icon
  - Text: `<active-github-username>` (e.g., `octocat`, `Nir-Bhay`)
  - Tooltip: `Current Active GitHub Account`
- **Switch Action Button**:
  - Label: `Switch`
  - Tooltip: `Switch Account`
  - Action: Opens account picker / add-account prompt.

### 3.2 Search & Filter Input
- **Search Icon**: Magnifying glass icon
- **Input Field**:
  - Placeholder: `Search Codespaces...`
  - Behavior: Instant real-time filtering matching against:
    - Codespace Name / Display Name
    - Repository Name (`owner/repo`)

---

## 4. Codespace Card Item Specification

Each item in the list represents a remote developer environment.

### 4.1 Card Status & Header Row
- **Status Indicator**:
  - States:
    - `Available` / `Running`: Online status indicator
    - `Shutdown` / `Stopped`: Offline/inactive status indicator
- **Codespace Name**:
  - Text: `displayName` (fallback to `name`)
  - Tooltip: Full display name or identifier
  - Interaction: Clicking title or sub-row expands/collapses the details drawer.
- **Primary Quick Action Buttons (Right-aligned)**:
  1. **Connect Button**:
     - Icon: Play icon
     - Tooltip: `Connect in Antigravity IDE`
     - Action: Directly resolves SSH tunnel and opens remote workspace.
  2. **Power Toggle Button**:
     - If Online / Running:
       - Icon: Stop square icon
       - Tooltip: `Stop Codespace (save hours)`
       - Action: Stops container to prevent quota burn.
     - If Offline / Stopped:
       - Icon: Power button icon
       - Tooltip: `Turn ON Codespace`
       - Action: Sends REST boot command to wake up container.
  3. **Browser Access Button**:
     - Icon: Globe icon
     - Tooltip: `Open in GitHub Web`
     - Action: Opens `https://github.com/codespaces/<name>` in external browser.

### 4.2 Card Sub-Row (Metadata)
- **Repository**:
  - Icon: Repository book icon
  - Text: Short repo name (e.g. `antigravity-codespaces`)
  - Tooltip: Full repository path (e.g. `Nir-Bhay/antigravity-codespaces`)
- **Git Branch**:
  - Icon: Branch fork icon
  - Text: Active Git branch name (e.g. `main`, `feature/sidebar`) or `—`

---

## 5. Expandable Details Drawer (Accordion / Dropdown)

Toggled by clicking the card title or sub-row.

### 5.1 Initial Drawer State
- Text while fetching metadata: `Loading machine specs & ports...`

### 5.2 Loaded Metadata Content
- **Machine Specifications**:
  - Icon: Server icon
  - Label: `Machine:`
  - Value: Spec description + cloud region (e.g., `2 vCPU, 8 GB RAM (WestUS2)`)
- **Last Active Timestamp**:
  - Icon: Clock icon
  - Label: `Last Active:`
  - Value: Relative time string (e.g., `just now`, `12m ago`, `3h ago`, `2d ago`)

### 5.3 Forwarded Ports Section (Conditional — Shown if ports exist)
- **Section Heading**: `Forwarded Ports:`
- **Port Rows (Repeated per exposed port)**:
  - Text: `Port <sourcePort> (<visibility>)` (e.g., `Port 3000 (private)`, `Port 8080 (public)`)
  - Icon: External link icon
  - Action: Clicking opens the forwarded port's live browser URL (`browseUrl`).

### 5.4 Drawer Action Buttons (Toolbar)
A row of secondary management operations:
1. **Test SSH**:
   - Icon: Lightning bolt / Zap icon
   - Label: `Test SSH`
   - Action: Measures tunnel latency in milliseconds and reports status.
2. **Rebuild**:
   - Icon: Hammer / Build icon
   - Label: `Rebuild`
   - Action: Triggers DevContainer rebuild (prompts: Standard Rebuild vs Full Clean Rebuild).
3. **Copy SSH**:
   - Icon: Terminal icon
   - Label: `Copy SSH`
   - Action: Copies CLI command (`gh cs ssh -c <name>`) directly to system clipboard.
4. **Delete**:
   - Icon: Trash can icon
   - Label: `Delete`
   - Variant: Danger / Destructive
   - Action: Prompts permanent deletion modal confirmation (`Delete "<name>"? This is permanent.`).

---

## 6. Edge States & Feedback

### 6.1 Empty List State (Authenticated, but 0 Codespaces found)
- Message: `No Codespaces found.`

### 6.2 Error / Failure State
- Error Message: `Failed to load Codespaces: <Error details>`
- Action Button: `Retry` (triggers `refresh`)

---

## 7. Account Switching & Login QuickPick Flows (Triggered from Sidebar)

When clicking `Switch` or the active account banner:
- **Header**: `Switch GitHub account`
- **List Items**:
  - `<account_name>` with description `(Active)` or `(native / pat / cli)`
  - Active indicator: Checkmark (`✓`) on the current active account
  - `$(key) Sign In with another GitHub Account`
  - `$(shield) Add Personal Access Token (PAT)`
- **Dismiss**: `Cancel` button

---

## 8. Rebuild Options Modal (Triggered from Expanded Drawer)

When clicking `Rebuild` on a Codespace:
- **Title**: `Rebuild Codespace`
- **Description**: `Choose the type of rebuild for "<codespace-name>".`
- **Options**:
  1. **Standard Rebuild**:
     - Badge: Blue circular icon with sync glyph
     - Title: `Standard Rebuild`
     - Subtitle: `Rebuild the dev container using existing configuration.`
  2. **Full Clean Rebuild**:
     - Badge: Light red circular icon with trash glyph
     - Title: `Full Clean Rebuild`
     - Subtitle: `Rebuild from scratch (deletes container, rebuilds everything).`
- **Dismiss**: `Cancel` button

---

## 9. Delete Confirmation Modal (Triggered from Expanded Drawer)

When clicking `Delete` on a Codespace:
- **Title**: `Delete Codespace?`
- **Icon / Badge**: Centered circular danger badge with red trash can glyph
- **Headline**: `Delete "<codespace-name>"?`
- **Warning Copy**: `This is permanent and cannot be undone.`
- **Actions**:
  - `Cancel` (secondary outline button)
  - `Delete` (solid danger red button)

