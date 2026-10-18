## ADDED Requirements

### Requirement: Environment overrides for the first judge
The system SHALL override `first_judge.model` from `BLASTPROOF_FIRST_JUDGE_MODEL` and `first_judge.threshold` from `BLASTPROOF_FIRST_JUDGE_THRESHOLD`, validated as file values are. Setting the model from the environment SHALL turn the first judge on for that run with the section's defaults, even when the config file has no `first_judge` section. The key SHALL NOT be read from a `BLASTPROOF_*` variable: it is read from the variable `first_judge.api_key_env` names.

#### Scenario: Turned on for one run
- **WHEN** the config file has no `first_judge` section and `BLASTPROOF_FIRST_JUDGE_MODEL=liquid/d1-ultra` is set
- **THEN** the run asks `liquid/d1-ultra` first, with a threshold of 0.7 and its key from `OPENROUTER_API_KEY`, and the config file is not modified

#### Scenario: Invalid threshold
- **WHEN** `BLASTPROOF_FIRST_JUDGE_THRESHOLD=0` is set
- **THEN** the CLI exits with a configuration error naming `BLASTPROOF_FIRST_JUDGE_THRESHOLD`
