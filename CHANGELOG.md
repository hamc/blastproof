# Changelog

All notable changes are recorded here. This project follows [semantic versioning](https://semver.org/);
while it is pre-1.0, a minor bump may change existing behaviour and a patch never does.

## Unreleased

### Security
- **Secrets could still reach the model.** `select` and `navigate` embed their resolved value in
  the result string, which was fed back into the next prompt as `lastResult` unmasked — so the
  0.2.0 guarantee held only for `fill`, the one action the regression test happened to cover.
  Everything crossing into a prompt is now masked at a single choke point, including the page
  snapshot, which can itself render a credential.

### Fixed
- `--fail-on-unmapped` silently did nothing without `--impacted`, since nothing is classified
  without a diff. It is now a usage error.
- `run --dry-run` reported a clean plan while ignoring test files that failed to parse, blessing a
  suite that was about to fail. It now reports them and exits 1.
- The action passed `--write` to `run`, which has no such flag, turning a plausible input
  combination into a hard failure.

### Documentation
- Removed a stale "known limitation" claiming `plan` cannot reach pages behind a login. It has used
  the `auth` recipe since 0.2.0.

## [0.2.1] — 2026-07-28

### Fixed
- `init` no longer scaffolds a runnable login test written for another application. It ships as
  `login.yaml.example`, inert until renamed, and uses `{{env.*}}` placeholders instead of literal
  credentials — a scaffolded test that assumed someone else's login failed on a newcomer's very
  first run.
- The repository's own config pointed at a GitHub organisation that does not exist. The generator
  was fixed in 0.1.2; the checked-in copy was not.

### Documentation
- The quick start now says to start your app and point `base_url` at it, which it previously assumed.
- The demo-app walkthrough now begins with a clone: `examples/` is not part of the npm package.

## [0.2.0] — 2026-07-27

Minor rather than patch: two changes alter existing behaviour.

### Security
- **The agent can no longer navigate outside the application under test.** An absolute URL previously
  ignored `base_url` entirely, so a page able to influence its own accessible text could send an agent
  holding a live session anywhere. Declare `allowed_origins:` for apps that legitimately span hosts.
  Enforced by comparison, not by prompt wording.
- **Secrets no longer reach the model.** `{{env.*}}` placeholders survive into the action and are
  substituted at the moment of typing, so a credential never enters a prompt — which matters because
  `llm.base_url` may point at a gateway you do not run.
- The system prompt now frames page content as data under test rather than instruction. This raises
  the cost of a casual injection and is explicitly **not** a security boundary.

### Fixed
- **BREAKING:** `llm.base_url` is now honoured for `provider: anthropic`. Traffic that silently reached
  the public API now goes to the configured endpoint.
- Two failing tests sharing a summary no longer overwrite each other's screenshot.

## [0.1.2] — 2026-07-27

### Added
- A consumable GitHub Action at the repository root, with a `score` output and a guard that rejects a
  shallow checkout before installing anything.

### Fixed
- The agent reported an already-satisfied step as a failure, reading "already done" as "impossible".

## [0.1.1] — 2026-07-27

### Fixed
- The CLI reported `0.0.1` regardless of the published version. It is now injected from the manifest
  at build time, and the release workflow verifies what the built binary reports.

## [0.1.0] — 2026-07-27

First public release: `init`, `run` (with `--impacted`), `plan` and `test`; authentication, JUnit and
HTML reports, a priority-weighted score with `--min-score`, and `--fail-on-unmapped`.
