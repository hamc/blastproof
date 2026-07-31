# run-budget Specification

## Purpose
TBD - created by archiving change run-budget-and-deadline. Update Purpose after archive.
## Requirements
### Requirement: A run is bounded by model calls, tokens and wall-clock time
A run SHALL carry a budget of a maximum number of model calls and a maximum number of tokens, and a deadline of a maximum wall-clock duration. Each SHALL be optional and independently configurable; an unconfigured limit SHALL NOT bound the run. Every model call made anywhere in the run — agent action, assert judgment, or test planning — SHALL count against the budget.

A limit is checked before the next unit of work is spent, so how far a run can exceed one depends on how much work can be in flight when the limit is crossed. Running tests one at a time, that is a single call. Running several at once, it is bounded by the configured concurrency, and this SHALL be documented rather than presented as an exact bound.

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

#### Scenario: Overshoot grows with concurrency
- **WHEN** a limit is crossed while several tests are in flight
- **THEN** the calls already in flight complete, so the run may exceed the limit by up to the configured concurrency

#### Scenario: A stop lets running tests finish
- **WHEN** a budget or deadline stops a run with tests in flight
- **THEN** those tests run to completion, no further test starts, and the remainder are reported as not run

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

### Requirement: A run reports what it spent
A run SHALL report the model calls and tokens it actually spent, for a completed run and for one stopped by its own budget or deadline alike. Where a limit is configured, the report SHALL name the spend against that limit; where none is, it SHALL report the figure alone.

The token figure SHALL distinguish "no tokens were reported" from "no tokens were spent". Where no completed call reported usage, the report SHALL say the figure is unavailable rather than showing zero; where only some calls reported it, the report SHALL say how many calls the figure covers.

The spend SHALL be reported once per budget. The command that constructed the budget is the one that reports it, so a composed run sharing one allowance across phases reports one total rather than one per phase.

#### Scenario: A completed run reports its spend
- **WHEN** a run finishes
- **THEN** the summary states the model calls and the tokens it spent

#### Scenario: An interrupted run reports its spend too
- **WHEN** a run is stopped by its budget or deadline
- **THEN** the summary states what was spent as well as which limit stopped it

#### Scenario: Reported against a configured limit
- **WHEN** a maximum number of calls is configured
- **THEN** the spend is reported against that maximum

#### Scenario: A provider that reports no usage
- **WHEN** no completed call reported token usage
- **THEN** the token figure is reported as unavailable, not as zero

#### Scenario: Only some calls reported usage
- **WHEN** some completed calls reported token usage and others did not
- **THEN** the reported total says how many calls it covers

#### Scenario: One allowance, one report
- **WHEN** one budget is shared across the phases of a composed run
- **THEN** the spend is reported once, by the command that created the budget

