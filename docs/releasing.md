# Releasing

## Release pipeline

The pull-request and `main` workflows build and validate a VSIX; they do not publish it. GitHub Releases and Open VSX publish only from a `v*` tag that exactly matches `package.json` via `scripts/check-release-tag.js`. Both publishing jobs use the `production-release` GitHub environment. Open VSX also requires the environment secret `OVSX_PAT`. Manual workflow dispatch from a branch may run a build, but cannot publish.

The Microsoft Visual Studio Marketplace listing is separate: no workflow in this repository updates it. See [reviewed Marketplace copy](MARKETPLACE_COPY.md).

## Prepare a release

Do not tag or publish until the release candidate has passed repository checks and any required live acceptance tests:

1. Confirm the requested changes are merged to `main` and the release commit is the exact commit to ship.
2. Run `npm ci --ignore-scripts`, `npm ci --prefix mcp-server`, `npm test`, `npm run check`, `npm run test:extension-host`, and `node --check mcp-server/index.mjs`. On headless Linux, prefix the host test with `xvfb-run -a`.
3. Run the [live smoke-test checklist](LIVE_SMOKE_TEST.md) for the editor/MCP client combinations the release will claim as tested. Record untested paths plainly.
4. Choose the next version. The accumulated changes after 5.3.2 are additive; **5.4.0** is a reasonable recommendation after the live smoke test, but the release maintainer should confirm the version and compatibility claims. Do not set a new package version merely to imply it has already been published.
5. Update `package.json` and `package-lock.json` together, add a dated release section to `CHANGELOG.md`, and update `SECURITY.md` supported-version rows if support changes. Verify the version/tag match with `node scripts/check-release-tag.js v<version>`.
6. Confirm the `production-release` environment has required reviewers and is restricted to approved `v*` tags. Protect version tags with a repository ruleset; keep `OVSX_PAT` in the environment secret. These repository settings cannot be verified or created by workflow files.
7. Merge the reviewed version/changelog commit, then create/push its exact version tag through the protected release flow. Never retag an existing release.

## Verify publication on each registry

After the release workflows finish successfully:

1. On [GitHub Releases](https://github.com/Nir-Bhay/antigravity-codespaces/releases), confirm the tag/version, release notes, and version-matched `.vsix` asset. Download it and inspect the embedded `package.json` version before installation.
2. On the [Open VSX listing](https://open-vsx.org/extension/nirbhay-hiwse/antigravity-codespaces), confirm the version and downloadable VSIX. The workflow's success is not a substitute for checking the public listing.
3. In the Visual Studio Marketplace publisher portal, upload/publish the same reviewed VSIX or approved package version using the publisher's credentials. Then verify the listing overview, version history, and install instructions on the public page. No Marketplace token is configured or used by this repository's workflows.
4. Compare the public versions and assets against the release commit. Record any registry delay or failure separately; a GitHub artifact alone is not publication.
5. Install the published artifact in the named editor/client versions and run the applicable acceptance checks. A merge, green CI, and public listing are distinct from proof of end-to-end behavior.

## Known external dependency follow-up

Issue [#42](https://github.com/Nir-Bhay/antigravity-codespaces/issues/42) tracked an upstream MSAL advisory in the Open VSX publisher dependency tree. `@azure/identity@4.14.1` now declares `@azure/msal-node` `^7.1.0`; this lockfile resolves `@azure/identity@4.14.1` and patched `@azure/msal-node@7.1.2` without an override. The current `npm audit` reports no vulnerabilities. Keep the audit and publisher verification in release checks, and do not add a cross-major override.
