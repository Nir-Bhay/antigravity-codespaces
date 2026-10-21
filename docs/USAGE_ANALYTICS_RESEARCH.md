# Codespaces usage analytics: research notes

Verified by the team (tesing bot, ide extension, progrmaer) against GitHub's docs, Oct 2026.

## Included quota (personal accounts, per month)

| Plan | Compute | Storage |
|---|---|---|
| GitHub Free | 120 core-hours | 15 GB-month |
| GitHub Pro | 180 core-hours | 20 GB-month |
| Team / Enterprise (org) | no personal quota, billed to the org | — |

Source: [About billing for GitHub Codespaces](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-codespaces/about-billing-for-github-codespaces)

**Core-hours = cores × hours.** A 2-core machine uses 2 core-hours per clock hour, so 120 core-hours is 60 h on 2-core, 30 h on 4-core and 15 h on 8-core.

## Prices beyond the quota

| Machine | USD / hour |
|---|---|
| 2-core | $0.18 |
| 4-core | $0.36 |
| 8-core | $0.72 |
| 16-core | $1.44 |
| 32-core | $2.88 |
| Storage | $0.07 per GB-month |

The quota resets at the start of each billing cycle. Without a payment method on file, codespaces can't start once the quota is used up.

## APIs

| Endpoint | What it gives | Notes |
|---|---|---|
| `GET /user` | `login`, `plan.name` | `plan` is only returned with the `user` scope |
| `GET /user/codespaces` | `machine.cpus`, `machine.name`, `state`, `last_used_at`, `billable_owner`, `idle_timeout_minutes` | Works with the `codespace` scope |
| `GET /users/{username}/settings/billing/usage/summary` | Per SKU: `grossQuantity`, `discountQuantity` (included quota used), `netAmount` | Preview. Enhanced billing platform only |
| `GET /users/{username}/settings/billing/usage` | Daily lines with `date`, `sku`, `quantity`, `repositoryName` | Enhanced billing platform only |

Docs: [Billing usage REST API](https://docs.github.com/en/rest/billing/usage), [Codespaces REST API](https://docs.github.com/en/rest/codespaces/codespaces), [Fine-grained PAT permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens), [Enhanced billing platform](https://docs.github.com/en/billing/using-the-new-billing-platform/about-the-new-billing-platform).

- **Permission:** the classic/OAuth `user` scope, or the fine-grained "Plan: read" permission. Fix: `gh auth refresh -h github.com -s user`.
- **404** is returned both when the scope is missing and when the account isn't on enhanced billing. A live test on Nirbhay's PC returned 404 and "needs the user scope".
- **Remaining quota is not returned by any endpoint.** It's computed as plan quota − included usage (`discountQuantity`, converted to core-hours using the SKU's core count).
- Billing data updates **hourly**, not in real time.
- Codespaces billed to an org (`billable_owner` ≠ user) don't count against personal quota and are shown as "Billed to {org}".

## How the extension uses this

1. Each signed-in account uses **its own token** (VS Code OAuth, stored PAT, or `gh auth token -u <login>`). The active gh account is never switched.
2. **Live mode:** the summary and daily usage endpoints are used.
3. **Needs permission:** 403/404 and the token lacks `user` → the card says "Usage needs permission" with a **Grant access** button.
4. **Estimated mode:** the API still fails with `user` present (e.g. not on enhanced billing) → usage is estimated from session start/stop times the extension records (globalState) × `machine.cpus`. Sessions run only in the browser while the extension isn't running are missed, so it's labelled **Estimated**.
5. Days left = remaining ÷ last-7-day average. Fewer than 3 days of data → "not enough data". Will last past reset → "lasts the full cycle". Remaining 0 → "quota used up".

Open item: the exact Codespaces SKU names haven't been confirmed on a live enhanced-billing account yet. The parser matches `codespace` + `N core` / `storage` loosely.
