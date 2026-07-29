# Changelog

All notable changes are recorded here. This project follows [semantic versioning](https://semver.org/);
while it is pre-1.0, a minor bump may change existing behaviour and a patch never does.

## [Unreleased]

### Added
- **Preflight: every unmet prerequisite is reported together, before anything is spent on.**
  `run`, `plan` and `test` now verify — in one pass, not one crash per invocation — that the
  browser can launch, that the configured model provider is reachable, and that `base_url`
  responds. Each check is shallow (a connection attempt, never a credential check or a model
  call), so a false failure never costs more than the raw dump it replaces. Checks are selected
  by what the command is about to spend: `--dry-run` needs none of them and stays fully keyless
  and browserless. When the browser check succeeds, the launched instance is reused for the run
  itself rather than launched twice. Silent when every prerequisite is met.
- **A failed browser launch now explains itself.** `chromium.launch()` failures at the two launch
  sites (`run`, `plan`) used to surface Playwright's raw exception — about forty lines, including
  the full Chrome command line printed twice, with the one line that mattered (a missing shared
  library) buried behind roughly three hundred characters of `--disable-*` flags. Two causes are
  now recognised and given a plain remedy: a missing system library (names the library and the
  `install-deps` command, and notes that installing it needs elevated privileges) and a browser
  that was never installed (names the `playwright install` command). An unrecognised cause still
  surfaces the underlying error — never swallowed — but with the browser's command line stripped
  either way.
- **`plan --dry-run`.** Reports the routes a draft would be generated for, and those already
  covered, without launching a browser or calling the LLM — the same keyless, browserless answer
  `run --impacted --dry-run` already gives, for the one command documented for coverage gaps that
  previously could not answer without a provider key.
- **An unknown configuration key now warns instead of vanishing.** `.blastproof/config.yaml` was
  validated by a plain `z.object`, which discards a key it does not recognise with no error, no
  warning and no effect — including a whole unrecognised section such as a `budget:` block pasted
  into a version that predated the feature. Loading the config now names every such key (nested
  sections included) and warns that it has no effect; the run still proceeds, since a config
  written for a newer blastproof must still work on an older one.

## [0.3.0] — 2026-07-29

### Added
- **A run can now be bounded by a budget and a deadline.** Optional config section `budget:`
  (`max_llm_calls`, `max_tokens`, `max_duration_s`) plus matching flags `--max-llm-calls`,
  `--max-tokens`, `--max-duration`, and `BLASTPROOF_MAX_*` environment overrides (precedence
  flag > env > file, same as every other setting) — on `run`, `plan`, and `test` alike, since the
  spec counts "agent action, assert judgment, or test planning" against one budget and `plan` makes
  model calls too. Enforced at the single choke point every model call already passes through
  (`createBrain`/`createPlanner`), so it is total by construction — agent actions, assert judgments
  and the planner are all counted. `test` composes `run` then `plan`; the two phases share one budget
  instance rather than each resolving its own, so the pipeline stays bounded by the configured
  maximum instead of up to double it. Exhausting it stops the run and reports it as **incomplete**:
  unexecuted tests are a new `not-run` state, excluded from the score entirely rather than counted as
  failures, and the process exits 1 unconditionally, even when the executed tests would satisfy
  `--min-score`. `run --dry-run` now also prints the worst-case model-call ceiling for the selection,
  labelled as a maximum, not a forecast: per step this is the iteration cap **plus** the configured
  `max_retries_per_step` (read from config, not assumed — it has no upper bound), because a malformed
  model response is retried without spending an iteration, so the two pools are independent and must
  be added rather than one doubled while the other is ignored; and it includes the login journey's
  steps when `auth.steps` is configured, since authentication spends model calls through the same loop
  before any test runs. Absent config and flags, nothing binds and behaviour is unchanged — motivated
  by measuring #15's flake rate exhausting a provider's credit mid-sequence with no partial accounting
  and no warning.

### Fixed
- A step whose `assert` judgment passed did not end the step: the executor recorded the pass and
  looped for another action, and `fail` was still legal on that extra turn — so the model could, and
  measurably did, fail a step it had just proved succeeded. A passing assertion now terminates the
  step immediately, exactly as `done` does; the failing-assertion path (retry within budget, then
  fail) is unchanged. Measured over twenty dogfood runs against an unchanged tree and app: **15%
  before the fix (3/20, one hole across five tests), 0% after (0/20)**. Under the old rate, twenty
  consecutive clean runs would occur about 3.9% of the time. The fix also removes the redundant turn
  each step spent after its assertion, so runs make fewer model calls than before.

## [0.2.2] — 2026-07-28

### Security
- **The mask now covers the whole run, and every command.** It was built per test from that test's
  own steps, so the credential typed at login was invisible to every test that followed — an
  authenticated page echoing it fed it straight to the model. `plan` had no masking at all, on a path
  that authenticates and then browses the session. And matching was literal, while `navigate` reports
  a percent-encoded URL, so a secret containing a space passed through untouched.
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
- `run --dry-run --fail-on-unmapped` printed the unclassified files and exited 0 — a false green in
  the keyless, browserless pre-flight most likely to be trusted in CI.

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
