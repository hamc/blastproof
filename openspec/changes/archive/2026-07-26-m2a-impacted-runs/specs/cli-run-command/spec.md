# Spec delta: cli-run-command (m2a-impacted-runs)

## ADDED Requirements

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
