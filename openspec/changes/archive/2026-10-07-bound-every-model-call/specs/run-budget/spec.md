# Spec delta: run-budget (bound-every-model-call)

## ADDED Requirements

### Requirement: The deadline ends a model call in flight
With a deadline configured, a model call still running when the deadline elapses SHALL be aborted, and the run SHALL stop for the deadline, reported as the deadline and not as a timeout or a refusal.

#### Scenario: A call that outlives the deadline
- **WHEN** a run with `--max-duration 20` is waiting on a call that has not answered after 20 seconds
- **THEN** the call is aborted, and the run stops as incomplete with the deadline as its reason

### Requirement: A call whose answer could not be used is counted
A model call that ends without a usable answer (its output did not parse, missed the schema, or was cut off at the output limit) SHALL count as a call, and its tokens SHALL count when the provider reported them.

#### Scenario: A runaway cut off at the limit
- **WHEN** a call is cut off at the output limit and the provider reports 5096 tokens for it
- **THEN** the run's call count and token count include it
