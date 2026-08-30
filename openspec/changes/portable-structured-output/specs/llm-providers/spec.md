# Spec delta: llm-providers (portable-structured-output)

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: A provider's refusal is quoted, not summarised
When a provider rejects a request, the error surfaced SHALL carry the provider's own explanation rather than a generic phrase.

#### Scenario: Schema refused by the provider
- **WHEN** the provider replies that the request is invalid and says why
- **THEN** the run reports what the provider said, not `Provider returned error`

#### Scenario: Any other provider error
- **WHEN** a provider refuses for an unrelated reason — credit, rate limit, an unknown model
- **THEN** its message reaches the user by the same path, with no per-case handling
