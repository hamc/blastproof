# Spec delta: llm-providers (count-a-malformed-judgment-as-an-attempt)

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

#### Scenario: A malformed judgment costs one attempt
- **WHEN** the judge's answer to an `assert` is malformed, and the step has attempts left
- **THEN** the error is recorded as the `assert`'s result, one attempt is spent, and the step continues instead of failing

#### Scenario: A malformed judgment at login is retried
- **WHEN** the judgment of `auth.verify` is malformed once and then answered
- **THEN** the login is verified on the answered judgment, and no `Authentication` error is reported

#### Scenario: A stop of the run is still a stop
- **WHEN** a judgment is refused by the provider, or the budget runs out during it
- **THEN** the run stops as incomplete, as before, and no attempt is counted

