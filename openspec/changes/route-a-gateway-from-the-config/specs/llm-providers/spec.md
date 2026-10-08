# Spec delta: llm-providers (route-a-gateway-from-the-config)

## ADDED Requirements

### Requirement: Extra request fields for OpenAI-compatible endpoints
`llm.extra_body`, an object, SHALL be merged into the JSON body of every model request when the provider is `openai` or `ollama`. A field blastproof sets SHALL NOT be replaced by it. `llm.extra_body` with provider `anthropic` SHALL be rejected when the configuration loads.

#### Scenario: Routing a gateway
- **WHEN** `llm.extra_body` is `{ provider: { require_parameters: true, ignore: [Venice] } }` with provider `openai`
- **THEN** every request body carries that `provider` object

#### Scenario: The output limit cannot be raised
- **WHEN** `llm.extra_body` sets `max_tokens: 64000`
- **THEN** requests still carry the output limit blastproof sets

#### Scenario: Not for Anthropic
- **WHEN** `llm.extra_body` is set with provider `anthropic`
- **THEN** loading the configuration fails with a message naming `llm.extra_body` and the provider

#### Scenario: Unset
- **WHEN** `llm.extra_body` is not set
- **THEN** requests are sent as before
