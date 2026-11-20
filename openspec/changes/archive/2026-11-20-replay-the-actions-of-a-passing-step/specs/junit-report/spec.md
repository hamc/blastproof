## ADDED Requirements

### Requirement: Replay counts as properties
With replay on, the JUnit report SHALL carry the number of steps replayed, resolved by the model and healed as suite properties. With replay off, the properties SHALL be absent.

#### Scenario: Counts
- **WHEN** a run with replay on replays 21 steps and the model resolves 2, 1 of them healed
- **THEN** the suite has properties `replayed_steps` 21, `model_steps` 2 and `healed_steps` 1
