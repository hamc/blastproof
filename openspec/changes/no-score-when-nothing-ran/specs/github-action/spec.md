## MODIFIED Requirements

### Requirement: Score output
The action SHALL expose the run score as an output, read from the JUnit report it produces. The output SHALL be empty whenever the report carries no score.

#### Scenario: Score available to a later step
- **WHEN** a run scores 85
- **THEN** a following step reads `85` from the action's `score` output

#### Scenario: No report produced
- **WHEN** the run fails before writing a report
- **THEN** the `score` output is empty rather than a fabricated number

#### Scenario: A run stopped before any test
- **WHEN** the provider refuses the first call and the report is written without a score
- **THEN** the `score` output is empty, not 100
