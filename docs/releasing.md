# Releasing

Both publishing jobs use the `production-release` GitHub environment and run only when the ref is a version tag (`refs/tags/v*`). A manual dispatch from a branch may build the VSIX, but it cannot create a GitHub Release or publish to Open VSX.

Before releasing, configure the repository's `production-release` environment with at least one required reviewer and restrict its deployment branches and tags to `v*`. Protect the `v*` tags with a repository ruleset that limits tag creation and updates to release maintainers. Store `OVSX_PAT` as an environment secret where practical. The workflows refer to these repository settings; the workflow files cannot create or enforce environment protection rules themselves.

To publish, dispatch the relevant workflow on an approved `v*` tag or push that tag after verifying it points to the reviewed release commit. The normal push to `main` builds and validates the VSIX without publishing it.
