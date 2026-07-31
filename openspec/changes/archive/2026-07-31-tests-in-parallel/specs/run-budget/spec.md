## MODIFIED Requirements

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
