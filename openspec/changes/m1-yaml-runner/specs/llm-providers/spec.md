# Spec: llm-providers

## ADDED Requirements

### Requirement: Provider factory
The system SHALL resolve an LLM provider from config (`llm.provider`: `anthropic` | `openai` | `ollama`) and model name, using the API key from the env var named by `llm.api_key_env` when required.

#### Scenario: Anthropic provider
- **WHEN** config sets provider `anthropic` and `api_key_env: ANTHROPIC_API_KEY` and the variable is set
- **THEN** the factory returns a working Anthropic model instance

#### Scenario: Ollama without key
- **WHEN** config sets provider `ollama` with a base URL and no API key
- **THEN** the factory returns an OpenAI-compatible client pointed at the Ollama base URL

#### Scenario: Missing API key
- **WHEN** the configured `api_key_env` variable is not set
- **THEN** the CLI fails fast with an error naming the missing variable before launching a browser

### Requirement: Structured output
All LLM decisions (next action, assert judgment) SHALL be produced via structured output validated by Zod schemas; malformed responses SHALL count as a failed attempt within the retry budget.

#### Scenario: Malformed LLM response
- **WHEN** the LLM returns output that fails schema validation
- **THEN** the executor retries the step with a fresh snapshot instead of crashing

### Requirement: Model defaulting
The system SHALL provide a sensible default model per provider when `llm.model` is omitted.

#### Scenario: Default model
- **WHEN** config omits `llm.model`
- **THEN** the factory uses the documented default for the chosen provider
