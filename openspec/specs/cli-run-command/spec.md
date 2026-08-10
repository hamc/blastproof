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
Without `--min-score`, the `run` command SHALL exit with code 0 when all executed tests pass and 1 when any test fails. With `--min-score <n>`, the threshold decides instead: exit 0 when the score is at least `n`, 1 otherwise. A run stopped by its budget or deadline SHALL exit 1 in both modes, since its result is incomplete rather than passing. Exit code 2 is reserved for usage/config errors in all modes.

#### Scenario: Failing test exits 1
- **WHEN** at least one executed test fails and no threshold was given
- **THEN** the process exits with code 1 after all tests complete

#### Scenario: Score below threshold exits 1
- **WHEN** the run is given `--min-score 80` and scores 60
- **THEN** the process exits with code 1

#### Scenario: Interrupted run exits 1
- **WHEN** a run is stopped by its budget or deadline, whatever the executed tests scored
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
The `run` command SHALL support `--dry-run`, printing the impacted selection (affected routes, unmapped files, selected and skipped tests) and the worst-case model-call count for that selection, without launching a browser or calling the LLM, exiting with code 0.

#### Scenario: Dry run output
- **WHEN** the user runs `blastproof run --impacted --dry-run`
- **THEN** the console shows affected routes, unmapped files and the tests that would run, and no browser is launched

#### Scenario: Dry run reports the ceiling
- **WHEN** a dry run reports its selection
- **THEN** it also reports the maximum number of model calls that selection could make

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

### Requirement: Budget and deadline flags
The `run` command SHALL accept `--max-llm-calls <n>`, `--max-tokens <n>` and `--max-duration <seconds>`, each overriding the corresponding config value. A non-positive or non-numeric value SHALL be a usage error.

#### Scenario: Flag overrides config
- **WHEN** the config sets a maximum of 500 model calls and the run is given `--max-llm-calls 100`
- **THEN** the run is bounded at 100

#### Scenario: Invalid limit
- **WHEN** the run is given `--max-llm-calls 0` or a non-numeric value
- **THEN** the CLI exits with code 2 and an actionable message

### Requirement: Tests may run concurrently
`run` SHALL support executing several tests at once, bounded by a configured maximum. The maximum SHALL be configurable in `.blastproof/config.yaml` as `concurrency:` and overridable per invocation with `--concurrency <n>`, the flag taking precedence over the file. A value below 1 SHALL be rejected with an explanatory error rather than clamped.

The default SHALL be 1. Tests are journeys driven against one running application, and whether two of them can run at the same time is a property of the application and the tests, not of the runner — so concurrency is opted into by the person who knows, never assumed on their behalf.

Results SHALL be reported in selection order on every surface, regardless of the order in which tests finish.

#### Scenario: Concurrency is opted into
- **WHEN** no `concurrency:` is configured and no flag is given
- **THEN** tests run one at a time, as they do today

#### Scenario: Several tests at once
- **WHEN** `concurrency: 4` is configured and more than four tests are selected
- **THEN** at most four run at the same time, and the rest start as earlier ones finish

#### Scenario: The flag beats the file
- **WHEN** the config declares a concurrency and `--concurrency` is given
- **THEN** the flag's value is used

#### Scenario: An invalid concurrency is refused
- **WHEN** a concurrency below 1 is configured or passed
- **THEN** the run fails with an explanatory error instead of silently choosing a value

#### Scenario: Report order does not depend on timing
- **WHEN** tests finish in a different order from the one they were selected in
- **THEN** the summary and every written report list them in selection order

### Requirement: Concurrent output stays readable
When more than one test can be in flight, each test's console output SHALL be presented as one contiguous block, printed when that test finishes, so that a step transcript can be read consecutively. When tests run one at a time, output SHALL stream as each event occurs, unchanged.

#### Scenario: Blocks, not interleaving
- **WHEN** several tests run at once
- **THEN** each test's header, steps and result appear together, not interleaved with another test's

#### Scenario: Live output is preserved when serial
- **WHEN** tests run one at a time
- **THEN** events print as they happen, exactly as before

### Requirement: Route drift warnings
The `run` command SHALL report route drift to standard error on every run — plain `run`, `--dry-run`, and `--impacted` — because drift is independent of the diff and of selection. Drift warnings SHALL be non-fatal and SHALL NOT change the exit code. Each warning SHALL name the test, the drifted route, and state that the route is declared by no `routes:` mapping and contributes nothing to `--impacted` selection.

#### Scenario: Plain run reports drifted routes
- **WHEN** the user runs `blastproof run` (no `--impacted`, no `--dry-run`) and a test declares a route no `routes:` mapping declares
- **THEN** the console warns on stderr about the drifted route, because drift is independent of the diff and of selection

#### Scenario: Dry run reports drifted routes
- **WHEN** the user runs `blastproof run --impacted --dry-run` and a test declares `/cart/` while config maps to `/cart`
- **THEN** the console warns on stderr that `/cart/` is declared by no `routes:` mapping and contributes nothing to `--impacted` selection, and the exit code is unaffected

#### Scenario: Impacted run reports drifted routes
- **WHEN** the user runs `blastproof run --impacted` and a test declares a route no mapping declares
- **THEN** the console warns on stderr naming the test and the route

#### Scenario: Dry run without --impacted reports drifted routes
- **WHEN** the user runs `blastproof run --dry-run` (no `--impacted`) and a test declares a route no `routes:` mapping declares
- **THEN** the console warns on stderr about the drifted route, because drift is independent of the diff

### Requirement: Authoring warnings

The `run` command SHALL report authoring findings to standard error on every run — plain `run`, `--dry-run`, and `--impacted` — because a step that names no value is independent of the diff and of selection. Warnings SHALL be non-fatal and SHALL NOT change the exit code. Each warning SHALL name the test, the step's position and its text, SHALL show the offending step rewritten with a value clause as the shape to follow, and SHALL state the consequence accurately: the executor is forbidden from inventing values by its prompt, but the prompt instructs rather than enforces, so the step passes over a value the model made up rather than failing. No warning SHALL describe such a step as one that cannot be carried out.

#### Scenario: Plain run reports an offending step
- **WHEN** the user runs `blastproof run` and a test declares `fill the note field`
- **THEN** the console warns on stderr naming the test and the step, and the exit code is unaffected

#### Scenario: Dry run reports an offending step
- **WHEN** the user runs `blastproof run --dry-run` and a test declares `fill the note field`
- **THEN** the console warns on stderr, and the exit code is unaffected

#### Scenario: Impacted run reports an offending step
- **WHEN** the user runs `blastproof run --impacted` and a test declares `fill the note field`
- **THEN** the console warns on stderr, whether or not that test is selected

#### Scenario: The warning shows the fix
- **WHEN** a warning is printed for `fill the note field`
- **THEN** it shows a corrected shape appending a value clause, and does not invent a value

#### Scenario: A clean suite prints nothing
- **WHEN** no step enters a value without naming one
- **THEN** no authoring output is written to stderr

### Requirement: --fail-on-authoring gate

The `run` command SHALL accept `--fail-on-authoring`, which promotes authoring findings from a warning to a failure. When the flag is passed and at least one finding exists, the command SHALL exit `EXIT_FAILED` (1) after parsing and before launching a browser, checking for an API key or making any model call. Without the flag, findings SHALL remain non-fatal. The flag SHALL require no other flag, because authoring is independent of the diff.

#### Scenario: Gate fails before anything is spent
- **WHEN** the user runs `blastproof run --fail-on-authoring` and a test declares `fill the note field`
- **THEN** the command exits 1 without launching a browser and without requiring an API key

#### Scenario: Gate passes on a clean suite
- **WHEN** the user runs `blastproof run --fail-on-authoring` and no step enters a value without naming one
- **THEN** the run proceeds normally and the exit code is decided as it would be without the flag

#### Scenario: Gate needs no companion flag
- **WHEN** the user runs `blastproof run --fail-on-authoring` without `--impacted`
- **THEN** the flag is accepted, unlike `--fail-on-unmapped` which requires a diff to classify

