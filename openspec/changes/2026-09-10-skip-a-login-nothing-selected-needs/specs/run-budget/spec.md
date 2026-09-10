# Spec delta: run-budget (skip-a-login-nothing-selected-needs)

## MODIFIED Requirements

### Requirement: The worst case is knowable before spending anything
The `run` command SHALL be able to report the maximum number of model calls a selection could make, derived from the step counts and the per-step iteration ceiling, without contacting a provider.

The ceiling SHALL count the login journey only when the selection can incur it. Where every selected test declares `auth: false`, the run performs no login, and the reported worst case SHALL NOT include one. The estimate and the run SHALL read the same selection, so the number cannot describe work the run will not do.

#### Scenario: Estimate in a dry run
- **WHEN** the user runs `blastproof run --impacted --dry-run`
- **THEN** the output includes the worst-case model-call count for the selected tests, alongside the selection itself

#### Scenario: Estimate is an upper bound, not a prediction
- **WHEN** the estimate is reported
- **THEN** it is presented as the ceiling the selection cannot exceed, not as an expected cost

#### Scenario: A selection that needs no login is not charged for one
- **WHEN** every selected test declares `auth: false` and `auth.steps` is configured
- **THEN** the reported ceiling covers the selected tests alone, and does not name the login journey

#### Scenario: A selection that needs a login is still charged for it
- **WHEN** a selected test wants the session and `auth.steps` is configured
- **THEN** the reported ceiling includes the login journey, as before
