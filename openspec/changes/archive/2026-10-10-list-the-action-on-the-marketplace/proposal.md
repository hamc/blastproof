# Proposal: list-the-action-on-the-marketplace

## Why

The composite action is used as `uses: hamc/blastproof@vX.Y.Z`, but it is not listed on the GitHub Actions Marketplace, where people search for a testing action (#155). Two things stand in the way:

- **The name is refused.** The Marketplace refuses a `name:` that matches a GitHub user or organization unless that account publishes the action. An organization `blastproof` exists and is not ours.
- **The CI docs install the wrong version.** `docs/ci.md`'s main example pins `uses: hamc/blastproof@v0.24.0` beside `version: '0.11.0'`, so a copy of it installs the 0.11.0 CLI. `RELEASING.md` updates the `@vX.Y.Z` references and never that input, which is #30's drift.

## What Changes

- `action.yml`'s `name` SHALL be `blastproof e2e AI testing`, and its description SHALL state the pull-request angle in under 125 characters: *"AI end-to-end tests for pull requests: runs the plain-English tests a diff affects in Playwright and gates the merge."*
- Every action ref and every `version:` pin in `docs/ci.md` SHALL equal `package.json`'s version. A test SHALL fail when one does not. The release commit already moves `package.json` and `docs/ci.md` together, so the test holds between releases and catches a release that moves only one.
- `RELEASING.md` SHALL describe the Marketplace step, which is manual on the release page.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `github-action`: a listing name the Marketplace accepts; documentation pins that agree with the release

## Impact

- `action.yml` (metadata only), `docs/ci.md`, `RELEASING.md`, `tests/action-manifest.test.ts`.
- `uses: hamc/blastproof@…`, the inputs, the outputs, the npm package and the CLI do not change.
- The new name shows in a job's log where the old one did.

## Non-goals

- **A moving major tag (`v1` or `v0`).** The project is pre-1.0, and a minor bump may change behaviour. A moving tag would carry that into pipelines that gate merges.
- **Automating the listing.** GitHub has no API for it.
- **PR comments, and the landing page.**
