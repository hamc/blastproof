## MODIFIED Requirements

### Requirement: Empty selection scores 100
When a run finished and no test executed, the score SHALL be 100 and the output SHALL state that no tests were executed. A run that was stopped before any test executed SHALL have no score, and the output SHALL say so: there is nothing to score, and 100 would read as a pass.

#### Scenario: Diff touches nothing testable
- **WHEN** `run --impacted` selects no tests because the diff affects no mapped route
- **THEN** the score is 100 and the output states that no tests were executed

#### Scenario: A run stopped before any test has no score
- **WHEN** the provider refuses the first call, so no selected test executes
- **THEN** no score is reported, the output says no test executed before the stop, and the process exits non-zero
