# run-budget Specification

## Purpose
TBD - created by archiving change run-budget-and-deadline. Update Purpose after archive.
## Requirements
### Requirement: A run is bounded by model calls, tokens and wall-clock time
A run SHALL carry a budget of a maximum number of model calls and a maximum number of tokens, and a deadline of a maximum wall-clock duration. Each SHALL be optional and independently configurable; an unconfigured limit SHALL NOT bound the run. Every model call made anywhere in the run — agent action, assert judgment, or test planning — SHALL count against the budget.

#### Scenario: Call budget exhausted
- **WHEN** a run configured with a maximum of 200 model calls attempts the 201st
- **THEN** the call is not made, the run stops, and the reason names the limit that was reached

#### Scenario: Token budget exhausted
- **WHEN** the tokens reported by completed calls reach the configured maximum
- **THEN** the run stops before the next call and the reason names the limit that was reached

#### Scenario: Deadline reached
- **WHEN** the configured wall-clock duration elapses
- **THEN** the run stops at the next check point and the reason names the elapsed limit

#### Scenario: No budget configured
- **WHEN** no budget or deadline is configured
- **THEN** the run proceeds without any limit, as it does today

### Requirement: An interrupted run is reported as incomplete, never scored as finished
A run stopped by its budget or deadline SHALL be reported as incomplete. The tests that did not execute SHALL NOT be counted as passing, the run SHALL NOT report a passing outcome on the strength of the tests that happened to finish first, and the process SHALL exit non-zero regardless of any `--min-score` threshold.

#### Scenario: Partial run does not report success
- **WHEN** a run of ten tests is stopped by its budget after six, all six having passed
- **THEN** the outcome is incomplete, the four unexecuted tests are reported as not run, and the process exits non-zero

#### Scenario: Threshold does not rescue an incomplete run
- **WHEN** an incomplete run's executed tests would satisfy `--min-score`
- **THEN** the threshold does not apply and the process still exits non-zero

#### Scenario: Reports mark the run incomplete
- **WHEN** an incomplete run writes a JUnit or HTML report
- **THEN** both state that the run was stopped, name the limit reached, and distinguish unexecuted tests from failed ones

### Requirement: The worst case is knowable before spending anything
The `run` command SHALL be able to report the maximum number of model calls a selection could make, derived from the step counts and the per-step iteration ceiling, without contacting a provider.

#### Scenario: Estimate in a dry run
- **WHEN** the user runs `blastproof run --impacted --dry-run`
- **THEN** the output includes the worst-case model-call count for the selected tests, alongside the selection itself

#### Scenario: Estimate is an upper bound, not a prediction
- **WHEN** the estimate is reported
- **THEN** it is presented as the ceiling the selection cannot exceed, not as an expected cost

