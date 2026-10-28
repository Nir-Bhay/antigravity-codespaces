# Product roadmap and improvement opportunities

This document is a set of recommendations, not a promise or a list of implemented features. Priorities reflect likely user value and risk reduction; validate them with user feedback and issue activity before committing to larger work. Compatibility and performance claims should be backed by reproducible checks, not assumed from a successful build.

## Product direction

Help developers manage GitHub Codespaces from VS Code-based editors and let coding agents use a separate MCP server for controlled remote command execution. Keep onboarding understandable, make account and cost effects visible before lifecycle actions, and describe editor support according to evidence.

## Recommended next steps

The next three scoped work items are tracked separately so each can be implemented, tested, and reviewed on its own:

1. [Sidebar onboarding and feature discoverability (#56)](https://github.com/Nir-Bhay/antigravity-codespaces/issues/56) — clarify the path from install through first connection and surface existing features at the right moment.
2. [Codespaces cost and lifecycle safety overview (#55)](https://github.com/Nir-Bhay/antigravity-codespaces/issues/55) — make account, state, freshness, compute/storage distinction, and destructive effects clear before actions.
3. [Standalone MCP setup and safe operation (#54)](https://github.com/Nir-Bhay/antigravity-codespaces/issues/54) — improve client configuration, preflight, transfer preview, and cleanup reporting without implying the MCP server is bundled into the extension.

These issues are proposals, not claims of implemented behavior. Issue [#22](https://github.com/Nir-Bhay/antigravity-codespaces/issues/22) remains the broader MCP phase tracker; #54 deliberately narrows to user setup and operability.

### P0 — Improve trust and first-run success

1. **Publish a tested editor compatibility matrix.** Record editor/version, extension distribution source, Remote-SSH provider, install result, connect result, and known caveats. Mark rows as tested, community-reported, or unverified. Re-test after editor API or marketplace changes.
2. **Add a short demo and guided first-run path.** Show install, sign-in distinction (extension auth vs `gh` auth), Setup Doctor, and one connection. Include captions and a text alternative; keep the demo free of personal account data.
3. **Add an explicit cost/safety checkpoint for lifecycle actions.** Clarify that starting uses compute, stopping retains storage, and deletion is permanent. For future batch actions, preview selected workspaces and expected effects before confirmation.
4. **Test the MCP server with real clients using a disposable Codespace.** Record client/version, tool discovery, auth source, command result, startup/cleanup behavior, and billing effects. Do not describe live interoperability as proven until this is complete.
5. **Make permission requests understandable.** Explain that `user` permission is only for usage analytics and declining it leaves core Codespaces access intact; distinguish extension sign-in from GitHub CLI credentials in every setup flow.

### P1 — Reduce friction for regular users

1. **Improve empty, loading, stale, and error states.** Keep the last successful list visible with its age, distinguish refresh failure from an empty account, and give each actionable error one suggested fix.
2. **Add lifecycle safeguards and recovery feedback.** Show which account owns the selected Codespace, require deliberate confirmation for destructive actions, and surface partial failure/cleanup outcomes without implying success.
3. **Make support diagnostics more actionable.** Offer a concise copyable report with editor/version, extension version, CLI health, selected account identity (not credentials), and relevant sanitized failure details. State what the report omits and remind users to review before sharing.
4. **Broaden automated test coverage around real user journeys.** Add UI state tests where practical, authentication/account-switch cases, API pagination and timeout cases, and MCP failure/cleanup paths. Keep integration tests opt-in and cost-aware.
5. **Improve discovery and documentation.** Keep the README focused on use cases and setup, link separate task-specific guides, and add screenshots/demo assets only when they reflect the current UI.

### P2 — Explore after evidence and maintenance capacity

- **Bulk lifecycle actions:** valuable for users with many Codespaces, but add only with a clear selection summary, per-item outcomes, cancellation behavior, and confirmation for deletion.
- **Idle-cost assistance:** explain GitHub auto-stop settings and identify long-running workspaces before inventing a second scheduler; any new automation should be opt-in, visible, and reversible.
- **Localization:** measure demand and establish a string catalog before translating. Start with onboarding and error actions, then validate layout and accessibility in each language.
- **Team workflows:** investigate shared visibility and org permissions only with a clear least-privilege model; do not imply that personal account switching provides team governance.
- **Usage history:** offer locally stored trends only with an explicit retention/clear-data policy and clearly label estimates separately from GitHub-reported billing totals.

## UX polish checklist

- Show the active GitHub CLI account wherever it determines Codespace selection or usage data.
- Distinguish extension authentication (dashboard/API) from `gh` authentication (SSH/MCP) in onboarding and errors.
- Label stale/cached data with its last refresh time and disable mutations when state is not trustworthy.
- Use consistent names for start/wake, stop, rebuild, and delete; explain irreversible actions immediately beside the action.
- Make keyboard navigation, focus visibility, screen-reader labels, color contrast, and reduced-motion behavior part of UI acceptance checks.
- Avoid “one click,” “universal,” “first-class,” and performance guarantees unless tests support the specific claim and supported versions.

## How to choose the next item

Use issue frequency and severity, user onboarding feedback, support requests, and measured completion failures. For each candidate, define: target user/problem, smallest useful change, security/cost implications, acceptance criteria, automated coverage, and a manual test on each claimed editor. Prioritize trust and successful first connection before adding more dashboard surface area.
