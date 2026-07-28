# Spec delta: llm-providers (provider-base-url)

## MODIFIED Requirements

### Requirement: Provider factory
The system SHALL resolve an LLM provider from config (`llm.provider`: `anthropic` | `openai` | `ollama`) and model name, using the API key from the env var named by `llm.api_key_env` when required. When `llm.base_url` is configured, the factory SHALL direct the selected provider at that endpoint, whichever provider it is.

#### Scenario: Anthropic provider
- **WHEN** config sets provider `anthropic` and `api_key_env: ANTHROPIC_API_KEY` and the variable is set
- **THEN** the factory returns a working Anthropic model instance

#### Scenario: Configured endpoint is honoured
- **WHEN** config sets provider `anthropic` together with a `base_url`
- **THEN** the client is directed at that endpoint rather than the provider's public API

#### Scenario: Ollama without key
- **WHEN** config sets provider `ollama` with a base URL and no API key
- **THEN** the factory returns an OpenAI-compatible client pointed at the Ollama base URL

#### Scenario: Missing API key
- **WHEN** the configured `api_key_env` variable is not set
- **THEN** the CLI fails fast with an error naming the missing variable before launching a browser
