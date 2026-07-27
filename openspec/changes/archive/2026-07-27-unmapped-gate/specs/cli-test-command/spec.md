# Spec delta: cli-test-command (unmapped-gate)

## ADDED Requirements

### Requirement: Fail on unclassified files
The `test` command SHALL support `--fail-on-unmapped`, with the same meaning it carries on `run`.

#### Scenario: Pipeline blocked by an unclassified file
- **WHEN** the user runs `blastproof test --fail-on-unmapped` and the diff changes a file matching no glob
- **THEN** the process exits with code 1 and names the file
