# Spec delta: cli-run-command (steps-name-their-value)

## ADDED Requirements

### Requirement: Authoring warnings

The `run` command SHALL report authoring findings to standard error on every run — plain `run`, `--dry-run`, and `--impacted` — because a step the executor cannot carry out is independent of the diff and of selection. Warnings SHALL be non-fatal and SHALL NOT change the exit code. Each warning SHALL name the test, the step's position and its text, SHALL state that the executor is forbidden from inventing values, and SHALL show the offending step rewritten with a value clause as the shape to follow.

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
