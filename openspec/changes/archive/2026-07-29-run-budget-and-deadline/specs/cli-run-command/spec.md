## MODIFIED Requirements

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

### Requirement: Dry run
The `run` command SHALL support `--dry-run`, printing the impacted selection (affected routes, unmapped files, selected and skipped tests) and the worst-case model-call count for that selection, without launching a browser or calling the LLM, exiting with code 0.

#### Scenario: Dry run output
- **WHEN** the user runs `blastproof run --impacted --dry-run`
- **THEN** the console shows affected routes, unmapped files and the tests that would run, and no browser is launched

#### Scenario: Dry run reports the ceiling
- **WHEN** a dry run reports its selection
- **THEN** it also reports the maximum number of model calls that selection could make

## ADDED Requirements

### Requirement: Budget and deadline flags
The `run` command SHALL accept `--max-llm-calls <n>`, `--max-tokens <n>` and `--max-duration <seconds>`, each overriding the corresponding config value. A non-positive or non-numeric value SHALL be a usage error.

#### Scenario: Flag overrides config
- **WHEN** the config sets a maximum of 500 model calls and the run is given `--max-llm-calls 100`
- **THEN** the run is bounded at 100

#### Scenario: Invalid limit
- **WHEN** the run is given `--max-llm-calls 0` or a non-numeric value
- **THEN** the CLI exits with code 2 and an actionable message
