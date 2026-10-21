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

## Real API shapes (verified live, Oct 2026)

- Summary items look like `{product:"Codespaces", sku:"codespaces_compute_d2", grossQuantity, discountQuantity, netQuantity, grossAmount, discountAmount, netAmount, pricePerUnit:0.18, unitType:"hours"}`.
  - Compute quantity is **machine-hours**, so core-hours = quantity × cores. Cores come from the SKU: `_dN`, `_cN` or `N-core`.
  - Storage (`codespaces_storage`) quantity is already **GB-month**, priced at $0.07, even though it's labelled `gigabyte-hours`.
- Daily items look like `{date, product:"codespaces", sku:"Codespaces compute 2-core" | "Codespaces storage", quantity, unitType:"Hours" | "GigabyteHours", grossAmount, discountAmount, netAmount, repositoryName}`.
- Product matching is case-insensitive.
- Fixtures: `test/fixtures/billing-usage-summary.json` and `billing-usage-daily.json`.

## Dollar value of the included quotas

The two quotas are **separate and not interchangeable**, so they are shown as two bars and never as one combined total.

| | Free | Pro | Constant |
|---|---|---|---|
| Compute | 120 core-hrs = **$10.80** | 180 core-hrs = **$16.20** | $0.09 per core-hour (2-core at $0.18/h ÷ 2) |
| Storage | 15 GB-month = **$1.05** | 20 GB-month = **$1.40** | $0.07 per GB-month |

Sources: [Codespaces pricing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-codespaces/about-billing-for-github-codespaces#pricing-for-paid-usage) and [Monthly included storage and core hours](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-codespaces/about-billing-for-github-codespaces#monthly-included-storage-and-core-hours-for-personal-accounts).

## POC: API output compared with the GitHub billing page

Account `octocat` (Pro), October 2026. Run `node scripts/usage-poc.js`:

```
Compute  76.5 / 180 core-hrs ($6.88 of $16.20)
Storage  7.64 / 20 GB-month ($0.53 of $1.40)
Billing  $7.42 consumed · -$7.42 discount · $0.00 billable
Repositories:
  repo-a                 73.9 core-hrs  $6.92
  repo-b                    2.6 core-hrs  $0.35
  repo-c            0.0 core-hrs  $0.16
```

GitHub billing page: $6.88 compute + $0.53 storage = **$7.42**. By repo: repo-a $6.92, repo-b $0.35, repo-c $0.16. All of it is covered by the included quota, so $0 is billable. **The figures match.**

## How the extension uses this

1. Usage is shown for the **active gh account** only, using that account's own token.
2. **Live:** the summary endpoint drives the compute and storage bars and the billing line. The daily endpoint drives the chart and the per-repository table.
3. **Needs permission:** 403/404 when the token lacks `user` → the card shows **Grant access** (`gh auth refresh -h github.com -s user`).
4. **Error:** any other failure, a 403/404 with the scope present, or an unrecognised SKU → a clear "Usage unavailable" with the reason and the gh command. **No estimated or guessed figures are ever shown.** Storage only ever comes from the billing API, never from disk size. Core-hours are never derived from dollars.
5. Days left = remaining ÷ last-7-day average. Fewer than 3 days of data → "not enough data". Will last past reset → "lasts the full cycle". Remaining 0 → "quota used up".
