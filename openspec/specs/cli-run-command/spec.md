# cli-run-command Specification

## Purpose

TBD - created by syncing change m1-yaml-runner. Update purpose after archive.

## Requirements

### Requirement: Test discovery
The `run` command SHALL discover all `.yaml`/`.yml` files under `.blastproof/tests/` recursively and execute them sequentially.

#### Scenario: Discovery
- **WHEN** `.blastproof/tests/` contains nested folders with YAML tests
- **THEN** all valid tests are discovered and executed in path order

### Requirement: Filters
The `run` command SHALL support `--tag <tag>` (repeatable), `--priority <P0|P1|P2>`, and `--query <text>` filters, executing only matching tests.

#### Scenario: Tag filter
- **WHEN** the user runs `blastproof run --tag smoke`
- **THEN** only tests tagged `smoke` execute

#### Scenario: Query filter
- **WHEN** the user runs `blastproof run --query "checkout"`
- **THEN** only tests whose summary contains "checkout" (case-insensitive) execute

### Requirement: Console reporting
The `run` command SHALL print per-step progress and a final summary table with per-test status, duration, and failure reasons; failure screenshots SHALL be written under `.blastproof/reports/<session>/`.

#### Scenario: Summary output
- **WHEN** a run finishes
- **THEN** the console shows passed/failed counts and each failed test lists its failing step and reason

### Requirement: Exit codes
Without `--min-score`, the `run` command SHALL exit with code 0 when all executed tests pass and 1 when any test fails. With `--min-score <n>`, the threshold decides instead: exit 0 when the score is at least `n`, 1 otherwise. Exit code 2 is reserved for usage/config errors in both modes.

#### Scenario: Failing test exits 1
- **WHEN** at least one executed test fails and no threshold was given
- **THEN** the process exits with code 1 after all tests complete

#### Scenario: Score below threshold exits 1
- **WHEN** the run is given `--min-score 80` and scores 60
- **THEN** the process exits with code 1

#### Scenario: Missing config exits 2
- **WHEN** `blastproof run` executes in a directory without `.blastproof/config.yaml`
- **THEN** the CLI exits with code 2 and an actionable error message

### Requirement: Impacted execution
The `run` command SHALL support `--impacted` with `--base <ref>` (default `main`), computing the PR diff and affected routes, and executing only tests whose declared `routes:` intersect the affected route set.

#### Scenario: Only impacted tests run
- **WHEN** the diff affects `/cart` and the suite contains tests covering `/cart` and `/login`
- **THEN** only the tests covering `/cart` execute

#### Scenario: Composition with filters
- **WHEN** `--impacted` is combined with `--tag`/`--priority`/`--query`
- **THEN** the impacted selection is further reduced by those filters

### Requirement: Unrouted tests under --impacted
Tests that declare no `routes:` SHALL NOT be executed by `--impacted`; they SHALL be reported as skipped-unrouted so the user can add coverage declarations.

#### Scenario: Unrouted test skipped and reported
- **WHEN** `--impacted` runs and a test has no `routes:` field
- **THEN** the test is skipped and listed under unrouted tests in the output

### Requirement: Uncovered route reporting
When no executed test covers an affected route, the CLI SHALL report the affected-but-uncovered routes and exit with code 0.

#### Scenario: No impacted tests
- **WHEN** the diff affects `/settings` and no test covers `/settings`
- **THEN** the output lists `/settings` as affected-but-uncovered, no tests execute, and the exit code is 0

### Requirement: Base URL override
The `run` command SHALL support `--url <url>`, overriding the config `base_url` for that run only.

#### Scenario: Run against a review environment
- **WHEN** the user runs `blastproof run --url https://preview-pr-42.example.com`
- **THEN** all navigation resolves against the given URL while the config file remains unchanged

### Requirement: Dry run
The `run` command SHALL support `--dry-run`, printing the impacted selection (affected routes, unmapped files, selected and skipped tests) without launching a browser or calling the LLM, exiting with code 0.

#### Scenario: Dry run output
- **WHEN** the user runs `blastproof run --impacted --dry-run`
- **THEN** the console shows affected routes, unmapped files and the tests that would run, and no browser is launched

### Requirement: Score in the summary
The `run` command SHALL print the run score in the final summary on every run, whether or not a score threshold was given.

#### Scenario: Score line always present
- **WHEN** a run finishes
- **THEN** the summary includes the score alongside the passed/failed counts

### Requirement: Minimum score flag
The `run` command SHALL support `--min-score <n>`. When given, the threshold SHALL determine the run outcome in place of the all-tests-must-pass rule: the run succeeds when the score is at least `n`, and fails otherwise. A value outside 0–100 SHALL be rejected as a usage error.

#### Scenario: Gate blocks a weak run
- **WHEN** the user runs `blastproof run --min-score 80` and the run scores 60
- **THEN** the output states that the score is below the threshold and the process exits with code 1

#### Scenario: Threshold tolerates a low-priority failure
- **WHEN** the user runs `blastproof run --min-score 80`, a P2 test fails, every other test passes and the score is 85
- **THEN** the process exits with code 0 despite the failed test

#### Scenario: Invalid threshold
- **WHEN** the user passes `--min-score 150`
- **THEN** the CLI exits with code 2 and an actionable error

### Requirement: JUnit flag
The `run` command SHALL support `--junit [path]`, writing the run's JUnit XML report to `path` when given, or to `junit.xml` inside the report session directory when the flag is used without a value.

#### Scenario: Report written to an explicit path
- **WHEN** the user runs `blastproof run --junit build/e2e.xml`
- **THEN** the JUnit report is written to `build/e2e.xml` and the path is reported on the console

### Requirement: HTML flag
The `run` command SHALL support `--html [path]`, writing a self-contained HTML report to `path` when given, or to `report.html` inside the report session directory when the flag is used without a value.

#### Scenario: Report written to an explicit path
- **WHEN** the user runs `blastproof run --html build/report.html`
- **THEN** the HTML report is written to `build/report.html` and the path is reported on the console

#### Scenario: Both reports at once
- **WHEN** the user runs `blastproof run --junit junit.xml --html report.html`
- **THEN** both files are written and both paths are reported

### Requirement: Fail on unclassified files
The `run` command SHALL support `--fail-on-unmapped`, failing the run with exit code 1 when the diff contains a file matching neither a `routes:` glob nor an `ignore:` glob. The failure message SHALL name the unclassified files and state both resolutions: mapping them in `routes:` or declaring them irrelevant in `ignore:`.

#### Scenario: Unclassified file blocks the run
- **WHEN** the user runs `blastproof run --impacted --fail-on-unmapped` and the diff changes `src/lib/money.ts`, which matches no glob
- **THEN** the process exits with code 1 and the output names that file and both ways to resolve it

#### Scenario: Ignored files do not block
- **WHEN** the diff changes only files matching `ignore:` globs
- **THEN** the run is not failed by this flag

#### Scenario: The flag is additive
- **WHEN** a run meets its `--min-score` threshold but the diff contains an unclassified file and `--fail-on-unmapped` is set
- **THEN** the process exits with code 1

#### Scenario: Without the flag
- **WHEN** the diff contains an unclassified file and the flag is not set
- **THEN** the file is reported and the exit code is unaffected
