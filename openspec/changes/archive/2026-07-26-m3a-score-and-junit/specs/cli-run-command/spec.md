# Spec delta: cli-run-command (m3a-score-and-junit)

## ADDED Requirements

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

## MODIFIED Requirements

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
