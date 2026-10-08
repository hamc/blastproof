# Proposal: bound-every-model-call

## Why

A model call is bounded neither in what it produces nor in how long it takes.

- **Output (#126).** No call sets `maxOutputTokens`, so each reserves the provider's maximum, 64000 for Haiku through OpenRouter. An account with 46308 tokens left had every call refused. Open-weight models with reasoning sometimes open the JSON object and then emit whitespace until that maximum. In 840 calls through six providers, runaways reached 65k–131k tokens. About one `gpt-oss` answer in ten was padded this way and still parsed, minutes later.
- **Time (#133).** No call has a timeout. Against a provider that never answers, a run given `--max-duration 20` was still waiting 30 s later. A runaway ends only at the HTTP client's 5-minute headers timeout, and three open-model suites stopped that way. SIGTERM does not end the process. Playwright's handler closes the browser without exiting, so a cancelled CI job waits for SIGKILL.

Measured output, in tokens:

| | visible answer | reasoning |
| --- | --- | --- |
| Haiku, Luna (suite + plan) | ≤ 325 | ≤ 434 (Luna) |
| open-weight, clean answers | ≤ ~425 | p99 ≈ 1,600 (`gpt-oss`), ≈ 9,000 (`qwen3.6`) |

## What Changes

- **Output limit.** Every call SHALL set `maxOutputTokens` to 4096. An answer cut at the limit SHALL count as one malformed attempt, and its reason SHALL name the limit.
- **Call timeout.** Every call SHALL be aborted after `llm.timeout_s`: default 300, 900 for `ollama`, overridable with `BLASTPROOF_LLM_TIMEOUT_S`. A timed-out call SHALL stop the run as incomplete, as a call with no response does (#125). The reason SHALL name the setting and say to raise it for a slow local model.
- **Deadline in flight.** A call still running when the deadline elapses SHALL be aborted, and the run SHALL stop for the deadline.
- **Signals.** SIGTERM and SIGHUP SHALL end the process with 143 and 129, closing the browser, as SIGINT already does with 130.
- **Spend.** A call whose answer could not be used SHALL count against the budget (#136). A cut-off runaway is exactly such a call.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `llm-providers`: every call is bounded in output and in time
- `run-budget`: the deadline ends a call in flight
- `config-overrides`: `BLASTPROOF_LLM_TIMEOUT_S`
- `cli-run-command`: SIGTERM and SIGHUP end the process

## Impact

- `src/llm/brain.ts` (`countedGenerate`), `src/runner/budget.ts`, `src/config.ts`, `src/cli.ts`, docs. No new dependencies
- A call running past 4096 tokens now fails as an attempt instead of finishing minutes later: measured, only runaways and one open model's longest reasoning

## Non-goals

- **A configurable output limit.** It follows from the schemas, and the data does not separate the three call shapes: reasoning dominates, whatever the shape. If a model needs more, #150's provider options are the place for it
- **Writing reports on a signal.** A cancelled job is not a result
- **#150**, the providers that ignore the JSON schema
