# Spec delta: agentic-execution (deterministic-verdicts)

## ADDED Requirements

### Requirement: A judgment is a decision, not a sample
The model call that judges a step SHALL be made with `temperature: 0`. The calls that choose the next action and that draft a test SHALL NOT be pinned, because their latitude is what re-resolves an element the test's author did not anticipate.

#### Scenario: Judging is pinned
- **WHEN** a step's expectation is judged against a snapshot
- **THEN** the call carries `temperature: 0`

#### Scenario: Acting is not pinned
- **WHEN** the model is asked for the next action, or for a test draft
- **THEN** the call carries no temperature, and the provider's default applies

#### Scenario: The same page reaches the same verdict
- **WHEN** the same expectation is judged twice against the same snapshot and history
- **THEN** the two calls are identical in everything the model receives, including the temperature

### Requirement: The limit of the guarantee is documented
The documentation SHALL state that pinning narrows verdict variance and does not make a run reproducible, naming provider batching and gateway routing as what remains.

#### Scenario: A reader looks for a repeatability guarantee
- **WHEN** the reader reaches what the documentation says about verdicts
- **THEN** it says the judgment is pinned, and that identical output across runs is not guaranteed
