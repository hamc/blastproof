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
