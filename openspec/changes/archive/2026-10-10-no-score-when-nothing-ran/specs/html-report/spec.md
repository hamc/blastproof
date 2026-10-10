## MODIFIED Requirements

### Requirement: Score and verdict lead the report
The report SHALL open with the run score, the pass and fail counts, and — when a threshold was given — the gate verdict. A run with no score SHALL show no number and no gate verdict, and SHALL say that no test executed.

#### Scenario: Gate verdict shown
- **WHEN** a run scores 60 against a threshold of 80
- **THEN** the report states the score, the threshold and that the gate failed

#### Scenario: No threshold
- **WHEN** no threshold was given
- **THEN** the score is shown without a gate verdict

#### Scenario: A run with no score
- **WHEN** a run is stopped before any test executed, with a threshold of 80
- **THEN** the report shows no score and no gate verdict, and says no test executed
