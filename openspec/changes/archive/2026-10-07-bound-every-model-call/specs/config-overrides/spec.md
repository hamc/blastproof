# Spec delta: config-overrides (bound-every-model-call)

## ADDED Requirements

### Requirement: Environment override for the model call timeout
The system SHALL override `llm.timeout_s` from `BLASTPROOF_LLM_TIMEOUT_S`, validated as a positive number of seconds.

#### Scenario: Timeout raised for one run
- **WHEN** `BLASTPROOF_LLM_TIMEOUT_S=900` is set
- **THEN** every model call of the run is allowed 900 seconds, and the config file is not modified

#### Scenario: Invalid timeout
- **WHEN** `BLASTPROOF_LLM_TIMEOUT_S=0` is set
- **THEN** the CLI exits with code 2 naming the variable
