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
All LLM decisions (next action, assert judgment) SHALL be produced via structured output validated by Zod schemas; malformed responses SHALL count as a failed attempt within the retry budget. A response is malformed when it arrived and could not be used: it failed schema validation, was rejected by our own parsing, or carried a successful status with a body that does not parse. A call that got no response at all is not malformed (see "A call the provider refused stops the run"). The schemas SHALL be expressed in the subset every supported provider accepts: a field that may be absent is declared **nullable and present**, never omitted, because strict validators require every key of an object to appear in `required` and refuse the request otherwise.

#### Scenario: Malformed LLM response
- **WHEN** the LLM returns output that fails schema validation
- **THEN** the executor retries the step with a fresh snapshot instead of crashing

#### Scenario: A provider that validates the schema before running the model
- **WHEN** a request is sent to a provider enforcing strict structured output
- **THEN** the schema is accepted and the model is asked

#### Scenario: An absent value reaches the consumer as it always has
- **WHEN** the model omits a value, sending `null`
- **THEN** the parsed action carries `undefined` for that field, and no consumer of the action distinguishes it from today

#### Scenario: A malformed judgment costs one attempt
- **WHEN** the judge's answer to an `assert` is malformed, and the step has attempts left
- **THEN** the error is recorded as the `assert`'s result, one attempt is spent, and the step continues instead of failing

#### Scenario: A malformed judgment at login is retried
- **WHEN** the judgment of `auth.verify` is malformed once and then answered
- **THEN** the login is verified on the answered judgment, and no `Authentication` error is reported

#### Scenario: A stop of the run is still a stop
- **WHEN** a judgment is refused by the provider, or the budget runs out during it
- **THEN** the run stops as incomplete, as before, and no attempt is counted

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

### Requirement: A call the provider refused stops the run
A model call that ends without a response from the provider SHALL stop the run as incomplete, by the same path a budget stop takes. It SHALL NOT be counted as a failed attempt, fail a step, fail a login, or fail a test. A call ends without a response when it ends in an HTTP error status (400 or above) or in no status at all (the provider could not be reached), including after the provider SDK's own retries. The decision SHALL be made on the error's type and status, never on its message, and SHALL be made once, where every model call passes, so that the executor, the judge, the login check and the planner are all covered.

The reason the run reports SHALL include the HTTP status when there is one and the provider's own explanation, and SHALL say what to do by status class: check the API key named by `llm.api_key_env` for 401 or 403; add credit for 402; run again later for 408, 409, 429 or any 5xx; check `llm.base_url` and the network when there is no status.

#### Scenario: An exhausted account does not fail the tests
- **WHEN** the provider answers HTTP 402 to a model call during a test
- **THEN** that test and every test after it are reported as not run, none as failed, the run is incomplete, and the reason quotes the provider and says to add credit

#### Scenario: A rejected key during login is not a broken login
- **WHEN** the provider answers HTTP 401 during the login journey
- **THEN** the run is incomplete, every selected test is reported as not run, and no `Authentication failed` error is reported

#### Scenario: An unreachable provider
- **WHEN** the provider cannot be reached after the SDK's retries
- **THEN** the run is incomplete and the reason says to check `llm.base_url` and the network

#### Scenario: Tests that finished before the refusal keep their results
- **WHEN** three tests finish and the provider then answers HTTP 503 on the fourth, after the SDK's retries
- **THEN** the three keep their results and the rest are reported as not run

### Requirement: Every model call has an output limit
Every model call SHALL request at most 4096 output tokens, reasoning included where the provider counts it. An answer cut at that limit SHALL count as one malformed answer, a failed attempt as before, and its reason SHALL say that it reached the output limit.

#### Scenario: A whitespace runaway
- **WHEN** a model opens its JSON answer and emits whitespace without end
- **THEN** the call ends at 4096 tokens, the step records a failed attempt whose reason names the output limit, and the step continues

#### Scenario: Normal answers are unaffected
- **WHEN** a model answers within the limit
- **THEN** the answer is used as before

### Requirement: Every model call has a timeout
Every model call SHALL be aborted after `llm.timeout_s` seconds: 300 by default, 900 when the provider is `ollama`. A call aborted this way SHALL stop the run as incomplete, by the path a refused call takes. It SHALL NOT be counted as a failed attempt or fail a step, a login or a test. The reason SHALL name `llm.timeout_s` and `BLASTPROOF_LLM_TIMEOUT_S`, and say to raise it for a slow local model.

#### Scenario: A provider that never answers
- **WHEN** a provider accepts the connection and does not answer within `llm.timeout_s`
- **THEN** the run stops as incomplete within that time, and the reason names the setting

#### Scenario: A slow local model
- **WHEN** `llm.timeout_s: 1200` is configured for `ollama` and a call takes 1000 seconds
- **THEN** the call completes and its answer is used
