# Proposal: m4a-npm-release

## Why

Everything the project promises works, and nobody can use it: there is no published package, so the only way to run blastproof is to clone the repository and build it. Publishing is also the point of no return — the package name is claimed permanently and a published version can never be altered — so the metadata, the version and the release path all have to be right before the first `npm publish`, not after.

## What Changes

- Complete the package metadata npm displays: `author`, `repository`, `bugs`, `homepage`, `publishConfig`
- Set the first public version to **0.1.0**, signalling a pre-1.0 surface that may still change
- Add `prepublishOnly` so a publish cannot ship a stale or missing build
- Fix the scaffolded config's docs URL, which currently points at a repository that does not exist
- Remove the `lint` script, which invokes an `eslint` that is not a dependency and fails on every run
- Add a release workflow triggered by a `v*` tag: verify, build, publish with npm provenance
- README install instructions that match what the published package actually needs

## Capabilities

### Modified Capabilities

- `project-init`: the scaffolded config points at the project's real documentation URL

## Impact

- New dependencies: **none**
- Affects: `package.json`, `src/commands/init.ts`, `.github/workflows/release.yml` (new), README, `CONTRIBUTING.md`
- Requires an `NPM_TOKEN` secret on the repository before a release can run
- The publish itself is a human action: pushing the tag

## Non-goals

- Publishing from this change; the release runs when a tag is pushed, and that is the maintainer's decision
- The consumable GitHub Action (m4b), which installs the published package
- Adding a linter: removing a broken script is not the same as choosing and configuring one, and that deserves its own change
- No `1.0.0` commitment: the CLI surface is young and semver should say so
