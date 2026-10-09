## MODIFIED Requirements

### Requirement: Model defaulting
The system SHALL provide a default model per provider when `llm.model` is omitted, and the documentation SHALL show the reliability measurement each default was chosen on. The defaults are `claude-haiku-4-5` for `anthropic`, `gpt-6-luna` for `openai` and `gpt-oss:20b` for `ollama`.

#### Scenario: Default model
- **WHEN** config omits `llm.model`
- **THEN** the factory uses the documented default for the chosen provider

#### Scenario: A default names its evidence
- **WHEN** a reader looks up why a provider's default is that model
- **THEN** the configuration docs show the false FAIL and false PASS rates it was chosen on, the date measured, and the command that reproduces them
