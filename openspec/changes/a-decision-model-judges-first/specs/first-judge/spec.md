## Purpose

An opt-in decision model that judges a step before the LLM judge does. It passes the steps it is sure of without an LLM call and sends every other judgment to the LLM, which decides it and gives the reason.

## ADDED Requirements

### Requirement: The first judge is off unless configured
The system SHALL ask a decision model first only when the configuration's `first_judge` section names a model. Without that section, every judgment SHALL be made exactly as before: the LLM judge alone, with no request to any other endpoint.

The section SHALL take `model` (required), `api_key_env` (default `OPENROUTER_API_KEY`) and `threshold` (a probability strictly between 0 and 1, default 0.7). A missing model or a threshold out of range SHALL fail validation like any other config error, and an unknown key in the section SHALL be warned about like any other unknown key.

#### Scenario: No section, no change
- **WHEN** the configuration has no `first_judge` section
- **THEN** every judgment is made by the LLM judge, and the run makes no request to a decision endpoint

#### Scenario: Threshold out of range
- **WHEN** `first_judge.threshold` is `1.2`
- **THEN** the CLI exits with a configuration error naming `first_judge.threshold`

### Requirement: A missing key stops the run before it starts
When the first judge is configured and the variable named by `first_judge.api_key_env` is unset or empty, the run SHALL fail before launching a browser. The error SHALL name the variable and the decision model, and give a copy-pasteable remedy, to the same standard as the LLM's missing-key error. The key SHALL NOT be printed, logged or written to any report.

#### Scenario: Key not exported
- **WHEN** `first_judge.model` is set and `OPENROUTER_API_KEY` is unset
- **THEN** the run exits before launching a browser, naming `OPENROUTER_API_KEY` and the configured model

### Requirement: The first judge reads what the LLM judge reads
The first judge SHALL be asked about the same input the LLM judge receives for that judgment: the step, the claim and the step's record with every `{{env.NAME}}` placeholder written as its redaction label, and the masked page without element refs. It SHALL be asked one yes/no question, whose probability of "yes" is compared with the threshold. This SHALL hold for every judgment a run makes, including the re-observation after a failed one and the check that a login succeeded.

#### Scenario: Placeholders as labels
- **WHEN** a step names `{{env.PASSWORD}}` and the first judge is configured
- **THEN** the first judge's input carries `[redacted PASSWORD]`, never the placeholder and never the value

### Requirement: A pass above the threshold is a pass, after the label check
When the first judge's probability is at or above the threshold, the judgment SHALL pass without an LLM call, subject to the same label check every LLM pass goes through. A pass the label check turns into a failure SHALL be a failed judgment, with the label check's reason, and SHALL NOT be sent to the LLM judge.

A judgment the first judge passes SHALL say so where a reason would be: the model, the probability and the threshold, and that a decision model gives no reason.

#### Scenario: A confident pass
- **WHEN** the first judge answers 0.93 with a threshold of 0.7 and the step names no secret the page contradicts
- **THEN** the step's judgment passes, no LLM judge call is made, and the step's result names the model and the probability

#### Scenario: A wrong secret is still caught
- **WHEN** the first judge answers above the threshold on a step naming `[redacted TEST_EMAIL]` while the page shows only `[redacted TEST_OTHER]`
- **THEN** the judgment fails with the label check's reason

### Requirement: Everything else goes to the LLM judge
The LLM judge SHALL decide the judgment, exactly as it does without a first judge, when:

- the first judge's probability is below the threshold;
- the input is larger than the first judge's context can take, in which case the first judge SHALL NOT be called;
- the first judge's answer cannot be read as a probability.

A failure SHALL always carry the LLM judge's reason or the label check's, never a decision model's verdict alone.

#### Scenario: Below the threshold
- **WHEN** the first judge answers 0.4 with a threshold of 0.7
- **THEN** the LLM judge decides the judgment and its reason is the step's result

#### Scenario: A page too large
- **WHEN** the input exceeds what the first judge can take
- **THEN** no decision request is made for that judgment and the LLM judge decides it

### Requirement: Its calls are bounded like every model call
Each request to the first judge SHALL be checked against the run's budget before it is sent and counted after it returns, as one model call with the tokens it reports. It SHALL be aborted at `llm.timeout_s` or at the run's deadline, whichever comes first, and stop the run as a timeout or as the deadline exactly as an LLM call does. A response with an error status, or none at all after retries, SHALL stop the run as a provider refusal, quoting the provider.

#### Scenario: Budget reached
- **WHEN** the run's call budget is exhausted and a judgment is due
- **THEN** no decision request is sent and the run stops as incomplete

#### Scenario: Decision endpoint refuses
- **WHEN** the decision endpoint answers 401
- **THEN** the run stops as a provider refusal naming the status and quoting the provider's message

### Requirement: A run reports what the first judge did
When the first judge is configured, the run's summary SHALL say that it is experimental and name its model, and state how many judgments it passed and how many went to the LLM judge.

The run SHALL write one line per first-judge decision to `first-judge.jsonl` in the run's report directory: the test file, the step and the claim as judged, the page it read, the probability, the threshold, and the outcome (passed, failed by the label check, or sent to the LLM). Every text in it SHALL be the masked text the judge received, never a secret's value.

#### Scenario: Summary line
- **WHEN** a run with the first judge configured finishes
- **THEN** its summary states how many judgments the first judge passed and how many went to the LLM

#### Scenario: A pass can be audited
- **WHEN** the first judge passes a step
- **THEN** `first-judge.jsonl` holds the page it read and the probability it gave for that step
