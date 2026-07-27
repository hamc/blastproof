# Spec delta: cli-run-command (unmapped-gate)

## ADDED Requirements

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
