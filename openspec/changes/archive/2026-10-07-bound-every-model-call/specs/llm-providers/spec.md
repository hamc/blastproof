# Spec delta: llm-providers (bound-every-model-call)

## ADDED Requirements

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
