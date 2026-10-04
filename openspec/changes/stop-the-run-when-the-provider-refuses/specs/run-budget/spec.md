# Spec delta: run-budget (stop-the-run-when-the-provider-refuses)

## MODIFIED Requirements

### Requirement: An interrupted run is reported as incomplete, never scored as finished
A run stopped by its budget or deadline, or by a model provider refusing a call, SHALL be reported as incomplete. The tests that did not execute SHALL NOT be counted as passing, the run SHALL NOT report a passing outcome on the strength of the tests that happened to finish first, and the process SHALL exit non-zero regardless of any `--min-score` threshold. Every surface that reports the stop SHALL give its actual cause, never assume it was the budget.

#### Scenario: Partial run does not report success
- **WHEN** a run of ten tests is stopped by its budget after six, all six having passed
- **THEN** the outcome is incomplete, the four unexecuted tests are reported as not run, and the process exits non-zero

#### Scenario: Threshold does not rescue an incomplete run
- **WHEN** an incomplete run's executed tests would satisfy `--min-score`
- **THEN** the threshold does not apply and the process still exits non-zero

#### Scenario: Reports mark the run incomplete
- **WHEN** an incomplete run writes a JUnit or HTML report
- **THEN** both state that the run was stopped, name the limit reached, and distinguish unexecuted tests from failed ones

#### Scenario: A provider stop names the provider, not the budget
- **WHEN** a run is stopped by a provider refusal
- **THEN** the console, JUnit and HTML reports give the provider's reason, and none of them says the budget or deadline stopped it
