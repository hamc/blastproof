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
The `run` command SHALL exit with code 0 when all executed tests pass, 1 when any test fails, and 2 on usage/config errors.

#### Scenario: Failing test exits 1
- **WHEN** at least one executed test fails
- **THEN** the process exits with code 1 after all tests complete

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
