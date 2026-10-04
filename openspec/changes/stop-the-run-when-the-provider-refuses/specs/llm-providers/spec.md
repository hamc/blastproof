# Spec delta: llm-providers (stop-the-run-when-the-provider-refuses)

## ADDED Requirements

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

## MODIFIED Requirements

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
