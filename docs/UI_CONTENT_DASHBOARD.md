# Dashboard (Cloud Hub): Complete UI Content & Interaction Specification

> **Purpose**: Pure structural, functional, and textual specification of everything displayed and interactive in the Codespaces Cloud Hub full-page dashboard webview.
> **Note**: This document intentionally excludes themes, CSS colors, styling, and visual decoration. Use this raw blueprint to construct any new design.

---

## 1. Window & Page Header

### 1.1 Panel Identification
- **Webview Panel Title**: `Codespaces Cloud Hub`

### 1.2 Brand Section
- **Brand Icon**: Cloud icon
- **Main Heading (H1)**: `Antigravity Codespaces Cloud Hub`
- **Subheading / Tagline**: `Multi-Account Cloud Workspace Director · Enterprise Edition`

### 1.3 Global Header Action Controls (Top Right)
Four key actions accessible from the header:
1. **New Codespace Button** (Primary Action):
   - Icon: Plus icon
   - Label: `New Codespace`
   - Action: Initiates multi-step creation workflow (Select account → Choose/enter repo → Choose branch → Provision).
2. **Sync SSH Button**:
   - Icon: Sync circular arrows icon
   - Label: `Sync SSH`
   - Action: Generates and writes `ProxyCommand` SSH config blocks for all codespaces into `~/.ssh/config`.
3. **Refresh Button**:
   - Icon: Refresh arrows icon
   - Label: `Refresh`
   - Action: Invalidates local cache, polls GitHub API across all linked accounts, and re-renders data.
4. **Theme Toggle Button**:
   - Icon: Moon icon (when dark mode) / Sun icon (when light mode)
   - Tooltip: `Toggle Dark / Light Theme`
   - Action: Toggles between dark and light themes; triggers toast notification.

---

## 2. High-Level KPI Metric Tiles (Metrics Grid)

Four summary cards displayed above the main workspace view:

### 2.1 Tile 1: Total Workspaces
- **Header Label**: `TOTAL WORKSPACES`
- **Icon**: Server icon
- **Metric Display**: Number representing count of all Codespaces aggregated across all connected GitHub accounts (e.g. `8`).

### 2.2 Tile 2: Running Instances
- **Header Label**: `RUNNING INSTANCES`
- **Icon**: Power icon
- **Metric Display**: Number representing active Codespaces currently in the `Available` state (e.g. `2`).

### 2.3 Tile 3: Stopped (Saved)
- **Header Label**: `STOPPED (SAVED)`
- **Icon**: Clock icon
- **Metric Display**: Number representing dormant/shut down Codespaces that are consuming 0 compute hours (e.g. `6`).

### 2.4 Tile 4: Storage Tier
- **Header Label**: `STORAGE TIER`
- **Icon**: Shield icon
- **Metric Display**: `15 GB Free Tier`

---

## 3. Filtering & Search Toolbar

Positioned directly above the workspace cards grid.

### 3.1 Multi-Account Filter Chips
Allows instantaneous single-account or multi-account filtering:
- **Default "All" Chip**:
  - Avatar / Tag: `ALL`
  - Name: `All Accounts`
  - Count Badge: Total workspace count (e.g. `8`)
  - State: Active by default
- **Per-Account Chips (Repeated for each linked GitHub user)**:
  - Avatar: First 2 uppercase letters of username (e.g. `NI`, `OC`, `GH`)
  - Name: GitHub handle (e.g. `Nir-Bhay`)
  - Count Badge: Count of workspaces under that specific account (e.g. `3`)
  - Interaction: Clicking filters the grid below to display only workspaces belonging to this account.

### 3.2 Global Search Input
- **Search Icon**: Magnifying glass icon
- **Input Field**:
  - Placeholder: `Search by name, repository, branch... (Press / to focus)`
  - Filter Scope: Codespace name, Repository (`owner/repo`), and Branch.
- **Keyboard Shortcuts**:
  - Press `/` anywhere on the page: Focuses and selects search input.
  - Press `Escape` while focused: Clears search text, resets card visibility, and unfocuses input.

---

## 4. Workspace Card (Bento Card) Content Specification

Each card represents a cloud container instance.

### 4.1 Card Header & Status Row
- **Live Status Indicator (Radar)**:
  - Running / Online: Active dot + radiating pulse ring.
  - Stopped / Offline: Inactive static dot.
- **Title Block**:
  - Title: `displayName` (fallback: `name`), with tooltip showing full name.
  - Account Tag: Pill showing the GitHub account handle that owns this environment (e.g. `Nir-Bhay`).
- **Status Badge**:
  - If state is `Available`: `RUNNING`
  - If state is not `Available`: `STOPPED`

### 4.2 Information Section (Data Fields)
Four key attributes presented per container:
1. **Repository**:
   - Icon: Repository book icon
   - Text: `repository` (e.g. `Nir-Bhay/antigravity-codespaces`)
   - Tooltip: `Repository: <full_repo_name>`
2. **Git Branch**:
   - Icon: Branch fork icon
   - Text: `gitStatus.ref` formatted in monospace (e.g. `main`, `v5.0-release` or `—`)
   - Tooltip: `Branch: <branch_name>`
3. **Last Activity**:
   - Icon: Clock icon
   - Text: `Active <relative_time>` (e.g. `Active just now`, `Active 42m ago`, `Active 3d ago`)
   - Tooltip: `Last active`
4. **Idle Auto-Shutdown Warning** (Conditional — displayed only when container is RUNNING):
   - Icon: Moon icon
   - Text: `Idle timeout: <idleTimeoutMinutes>m` (e.g. `Idle timeout: 30m`)
   - Tooltip: `Auto-stops after <idleTimeoutMinutes>m inactivity`

### 4.3 Action Dock (Bottom Action Controls)
Consists of two primary action buttons on the left and five quick-utility icon buttons on the right:

#### Left Primary Actions:
1. **Connect Button**:
   - Icon: Play icon
   - Label: `Connect`
   - Tooltip: `Connect in Antigravity IDE`
   - Action: Wakes up container if needed, resolves SSH host alias, and mounts remote folder in Antigravity IDE.
2. **Power Toggle Button**:
   - When Container is RUNNING:
     - Icon: Stop square icon
     - Label: `Stop`
     - Tooltip: `Stop Codespace (save hours)`
     - Action: Shuts down VM to prevent usage of free compute hours.
   - When Container is STOPPED:
     - Icon: Power symbol icon
     - Label: `Start`
     - Tooltip: `Turn ON Codespace`
     - Action: REST wake-up command.

#### Right Utility Icon Buttons:
1. **Test SSH**:
   - Icon: Lightning bolt / Zap icon
   - Tooltip: `Test SSH Tunnel Latency`
   - Action: Pings tunnel and reports latency in milliseconds.
2. **Open in Web**:
   - Icon: Globe icon
   - Tooltip: `Open in GitHub Web`
   - Action: Launches `https://github.com/codespaces/<name>` in browser.
3. **Rebuild**:
   - Icon: Hammer / Build icon
   - Tooltip: `Rebuild DevContainer`
   - Action: Re-runs container build lifecycle.
4. **Copy SSH**:
   - Icon: Terminal prompt icon
   - Tooltip: `Copy SSH Command`
   - Action: Copies `gh cs ssh -c <name>` to system clipboard and triggers floating toast.
5. **Delete**:
   - Icon: Trash can icon
   - Tooltip: `Delete Codespace`
   - Variant: Danger / Destructive
   - Action: Triggers permanent deletion modal confirmation.

---

## 5. Toast Feedback & Empty / Error States

### 5.1 Toast Notification
A floating message popup at bottom-right corner:
- Triggers & Messages:
  - Copy SSH: `Copied: gh cs ssh -c <codespace-name>`
  - Theme change: `Switched to Light Mode` / `Switched to Dark Mode`
- Auto-dismiss duration: 3000ms.

### 5.2 Empty Workspace State
Displayed when account has 0 Codespaces or search returns 0 matches:
- Message: `No Codespaces found. Click "New Codespace" to provision one.`

### 5.3 Full-Page Error State
Displayed if loading fails:
- Title: `Failed to load Cloud Hub`
- Details: `<err.message>`

---

## 6. Modal Dialogs & Wizards Triggered by Dashboard Actions

### 6.1 "New Codespace" Provisioning Flow
- **Step 1 — Account Selection**:
  - Prompt: `Select GitHub account for new Codespace`
  - Items: List of accounts with `(Active)` indicator.
- **Step 2 — Repository Selection**:
  - Prompt: `Select repository`
  - Items:
    - User's recent repositories tagged with `Private` or `Public`.
    - Custom Option: `$(pencil) Enter repository manually...`
  - If manual chosen: Input prompt `Enter owner/repo` (placeholder: `owner/repo-name`).
- **Step 3 — Branch Selection**:
  - Prompt: `Branch name (leave empty for default)` (placeholder: `main`).
- **Step 4 — Progress Notification**:
  - Notification text: `Creating Codespace on <owner/repo>...`

### 6.2 "Rebuild DevContainer" Options
- Prompt: `Rebuild <codespace_name>?`
- Choice 1: `$(debug-start) Standard Rebuild` — "Uses layer cache"
- Choice 2: `$(symbol-event) Full Rebuild (no cache)` — "Clean container rebuild"

### 6.3 "Delete Codespace" Confirmation
- Modal Warning: `Delete "<codespace_name>"? This is permanent.`
- Options: `Delete` | `Cancel`
