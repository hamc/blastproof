# llm-providers Specification

## Purpose

TBD - created by syncing change m1-yaml-runner. Update purpose after archive.

## Requirements

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

### Requirement: Structured output
All LLM decisions (next action, assert judgment) SHALL be produced via structured output validated by Zod schemas; malformed responses SHALL count as a failed attempt within the retry budget. The schemas SHALL be expressed in the subset every supported provider accepts: a field that may be absent is declared **nullable and present**, never omitted, because strict validators require every key of an object to appear in `required` and refuse the request otherwise.

#### Scenario: Malformed LLM response
- **WHEN** the LLM returns output that fails schema validation
- **THEN** the executor retries the step with a fresh snapshot instead of crashing

#### Scenario: A provider that validates the schema before running the model
- **WHEN** a request is sent to a provider enforcing strict structured output
- **THEN** the schema is accepted and the model is asked

#### Scenario: An absent value reaches the consumer as it always has
- **WHEN** the model omits a value, sending `null`
- **THEN** the parsed action carries `undefined` for that field, and no consumer of the action distinguishes it from today

### Requirement: Model defaulting
The system SHALL provide a sensible default model per provider when `llm.model` is omitted.

#### Scenario: Default model
- **WHEN** config omits `llm.model`
- **THEN** the factory uses the documented default for the chosen provider

### Requirement: A provider's refusal is quoted, not summarised
When a provider rejects a request, the error surfaced SHALL carry the provider's own explanation rather than a generic phrase.

#### Scenario: Schema refused by the provider
- **WHEN** the provider replies that the request is invalid and says why
- **THEN** the run reports what the provider said, not `Provider returned error`

#### Scenario: Any other provider error
- **WHEN** a provider refuses for an unrelated reason — credit, rate limit, an unknown model
- **THEN** its message reaches the user by the same path, with no per-case handling
