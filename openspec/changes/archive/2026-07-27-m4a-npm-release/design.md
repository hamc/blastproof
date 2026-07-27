# Design: m4a-npm-release

## Context

The CLI builds to a single ESM bundle with dependencies left external, `files: ["dist"]` already narrows the tarball to seven files, and a pre-publication audit found no secrets, no local paths, no third-party code and no copyleft dependency. What is missing is the metadata npm surfaces, a version that describes the project honestly, and a repeatable path from tag to registry.

## Goals / Non-Goals

**Goals:** publishable metadata, an honest version, a release that cannot ship a stale build, provenance, and a fixed docs URL.

**Non-Goals:** publishing (a human pushes the tag), the consumable Action (m4b), choosing a linter.

## Decisions

### D1: 0.1.0, not 1.0.0
A major version is a promise that the command surface is stable. `test`, `auth` and `--fail-on-unmapped` all landed within days of this release, and no external user has run any of it. Publishing 1.0.0 would mean every subsequent adjustment to a flag is a breaking change requiring a major bump, which either freezes the design prematurely or makes the version number meaningless. 0.1.0 says what is true: usable, and still moving. 0.0.1 was rejected in the other direction — it reads as an empty placeholder and undersells a working pipeline.

### D2: Publishing is a human action, triggered by a tag
The workflow runs on `v*` tags rather than on every push to main. Publishing is irreversible: the name is claimed forever and a released version can never be edited. That decision belongs to a person, and a tag is the smallest explicit gesture that expresses it. Publishing from `main` on merge was rejected for exactly this reason — an accidental merge should not be able to claim a version number for eternity.

### D3: `prepublishOnly` runs the full verification
The publish path rebuilds and re-verifies rather than trusting whatever is in `dist/`. `dist/` is git-ignored, so a publish from a stale or absent build is a plausible mistake, and its consequence is an immutable broken release. Cheap insurance against the one class of error that cannot be corrected.

### D4: Provenance is enabled
Publishing with `--provenance` from GitHub Actions records a verifiable link between the tarball and the commit and workflow that produced it. For a tool that asks users to hand it an API key and let it drive a browser over their application, being able to prove the published artifact came from the public source is worth the one line it costs.

### D5: The broken `lint` script is removed, not fixed
`npm run lint` invokes an `eslint` that is not in `devDependencies`, so it fails for anyone who runs it — including a new contributor following the README. Choosing a linter, a config and a rule set is a real decision with its own churn; smuggling it into a release change would be scope creep. Removing the broken script makes the manifest honest today, and adding a linter stays a change someone can propose on its merits.

### D6: The docs URL is fixed before anything is published
The scaffolded config points at `github.com/blastproof/blastproof`, which does not exist. Shipping that would send every user to a dead link, and worse, to a namespace a third party could later register and control. The URL is trivially changed in a later version, but the current value is simply wrong and must not be baked into a first release.

## Risks / Trade-offs

- A tag pushed by accident publishes a version that cannot be recalled → Mitigation: `prepublishOnly` verifies first, and the tag is a deliberate, separate act from merging.
- `NPM_TOKEN` in repository secrets is a credential that can publish as the owner → Mitigation: it is used only by the release workflow, which runs on tags; scope it to this package if the registry allows.
- 0.1.0 may read as less trustworthy than 1.0.0 to some adopters → Accepted: overstating stability costs more the first time a flag has to change.

## Migration Plan

Nothing to migrate: no version has been published.

## Open Questions

(none)
