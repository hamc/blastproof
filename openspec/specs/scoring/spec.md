# scoring Specification

## Purpose

Reduce a run to one number a CI can compare against a threshold, weighted so that a failing critical journey costs more than a failing edge case.

## Requirements

### Requirement: Priority-weighted score
The system SHALL compute a run score as the percentage of executed test weight that passed, where a test weighs 3 at priority P0, 2 at P1 and 1 at P2, rounded to the nearest integer in the range 0–100.

#### Scenario: All tests pass
- **WHEN** three executed tests at P0, P1 and P2 all pass
- **THEN** the score is 100

#### Scenario: A critical test fails
- **WHEN** an executed P0 test fails and an executed P2 test passes
- **THEN** the score is 25, reflecting 1 of 4 weight units passing

#### Scenario: Priority changes the cost of a failure
- **WHEN** the same suite is run twice and the only difference is that a failing test is P0 in one run and P2 in the other
- **THEN** the run with the failing P0 scores lower

### Requirement: Score denominator is executed tests
Tests that did not execute SHALL NOT contribute to the score: tests removed by the `--tag`, `--priority` or `--query` filters, and tests skipped as unrouted under `--impacted`, are absent from both numerator and denominator.

#### Scenario: Filtered tests do not lower the score
- **WHEN** a suite of ten tests is run with `--tag smoke` and the two selected tests pass
- **THEN** the score is 100

#### Scenario: Unrouted skipped tests do not lower the score
- **WHEN** `--impacted` executes one passing test and skips three tests that declare no `routes:`
- **THEN** the score is 100 and the skipped tests are still reported

### Requirement: Empty selection scores 100
When no test executed, the score SHALL be 100 and the output SHALL state that no tests were executed.

#### Scenario: Diff touches nothing testable
- **WHEN** `run --impacted` selects no tests because the diff affects no mapped route
- **THEN** the score is 100 and the output states that no tests were executed

### Requirement: Unparseable test files count as failures
A test file that cannot be parsed SHALL be counted in the score as a failed test, not excluded.

#### Scenario: Broken YAML lowers the score
- **WHEN** a run executes one passing P1 test and encounters one unparseable test file
- **THEN** the score is below 100

### Requirement: Minimum score gate
When a minimum score threshold is given, it SHALL determine the run outcome in place of the all-tests-must-pass rule: the run succeeds when the score is at least the threshold. Without a threshold the score is informational and the all-tests-must-pass rule applies.

#### Scenario: Score below the threshold fails the run
- **WHEN** the run scores 60 and the threshold is 80
- **THEN** the run fails and the output states the score and the threshold

#### Scenario: Score at the threshold passes
- **WHEN** the run scores 80 and the threshold is 80
- **THEN** the gate passes

#### Scenario: Threshold tolerates a low-priority failure
- **WHEN** a P2 test fails, all other tests pass, the score is 85 and the threshold is 80
- **THEN** the run succeeds despite the failed test

#### Scenario: A threshold of 100 is strict
- **WHEN** any executed test fails and the threshold is 100
- **THEN** the run fails, matching the behavior without a threshold

#### Scenario: No threshold set
- **WHEN** a test fails and no threshold was given
- **THEN** the score is reported and the run fails under the all-tests-must-pass rule
