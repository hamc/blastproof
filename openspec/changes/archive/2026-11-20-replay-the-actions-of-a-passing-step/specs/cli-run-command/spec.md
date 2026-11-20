## ADDED Requirements

### Requirement: Replay flags
`run` and `test` SHALL accept `--replay` and `--no-replay`, which turn replay on or off for that invocation and win over the config file and the environment. `--dry-run` SHALL NOT read or write saved actions, and its ceiling SHALL stay the cost of a run with nothing saved.

#### Scenario: A fresh path on demand
- **WHEN** the config has `replay: true` and `run --no-replay` is invoked
- **THEN** the model is asked for every action, and no saved file is read or written
