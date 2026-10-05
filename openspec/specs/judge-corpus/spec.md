# judge-corpus Specification

## Purpose
TBD - created by archiving change replay-the-judge-corpus-on-two-models. Update Purpose after archive.

## Requirements

### Requirement: The corpus is replayed on every model named
`npm run eval:judge` SHALL replay every case in `evals/judge/cases/` on each model listed in `EVAL_MODELS`, a comma-separated list. Each model SHALL use the provider, base URL and key variable the configuration resolves, with only the model replaced. Without `EVAL_MODELS`, it SHALL replay on the configured model alone.

#### Scenario: Two models
- **WHEN** `EVAL_MODELS=anthropic/claude-haiku-4.5,openai/gpt-6-luna npm run eval:judge` runs
- **THEN** every case is judged on both models, the configured number of samples each, and the report gives each case's result per model

#### Scenario: No list
- **WHEN** `npm run eval:judge` runs without `EVAL_MODELS`
- **THEN** it replays on the configured model, as before

### Requirement: A regression on any model fails the replay
The replay SHALL exit 1 when a case not marked `knownFailing` is judged wrong in any sample on any model, and the report SHALL name the models that got it wrong. A case marked `knownFailing` SHALL be reported as now passing only when it is judged right in every sample on every model.

#### Scenario: A case only one model gets wrong
- **WHEN** an unmarked case is right on one model and wrong on the other
- **THEN** the replay exits 1 and names the model that got it wrong

#### Scenario: A known failure fixed on one model only
- **WHEN** a case marked `knownFailing` is right on one model and wrong on the other
- **THEN** it is not reported as now passing, and the report shows which model still fails it

### Requirement: An unusable answer is scored, not fatal
An error from a judgment that is not a stop of the run SHALL be scored as a wrong sample, with the error as its reason, and the replay SHALL continue. A stop of the run SHALL end the replay.

#### Scenario: An answer cut off mid-JSON
- **WHEN** one judgment's answer cannot be parsed
- **THEN** that sample is wrong, the reason quotes the error, and every other case is still replayed

#### Scenario: An exhausted balance
- **WHEN** the provider refuses a judgment with HTTP 402
- **THEN** the replay stops and says so, rather than scoring every remaining sample wrong
