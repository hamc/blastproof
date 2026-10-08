# Design: bound-every-model-call

## Context

`countedGenerate` in `src/llm/brain.ts` is the one place every model call passes: the executor's action, both judgments, the login check and the planner. The budget lives there for that reason, and so do both bounds here.

## D1. One output limit, 4096 tokens

The issue proposed three limits, one per call shape. The measurement does not support that. The largest visible answer of any shape, on any model, was about 425 tokens. A planner draft was the largest of the reference models', at 173 visible tokens. What varies is reasoning, and reasoning does not depend on the shape. 4096 is about 2.5× the `gpt-oss` p99 and about 10× the largest reference-model output. It cuts a whitespace runaway after seconds instead of minutes.

It also cuts the reasoning tail of `qwen3.6` (p99 ≈ 9,000 tokens). Those calls become malformed attempts. That is accepted: the alternative is a limit sized to the longest thinking any model might do, which is no limit.

A truncated answer arrives as the AI SDK's `NoObjectGeneratedError` with `finishReason: 'length'`. It stays what a malformed answer has always been, one failed attempt, but its message says `the answer reached the 4096-token output limit`. A step that fails three times this way says why.

Rejected: **making it configurable.** #126 already doubted it, and the data says the right value follows from the schemas. #150's provider-options pass-through will cover a model that needs more.

## D2. A call timeout, `llm.timeout_s`

Each call is aborted after `llm.timeout_s`. The longest healthy call is a full answer at the output limit, so the default is sized for that, not for a typical call. The first default was 120 s. In verification, `gpt-oss-20b` through OpenRouter passed 7 tests, with 5 runaways cut at the limit and recovered. Then one call outlived 120 s on a slow provider and stopped the run. A gateway's slower providers stream open-weight models at tens of tokens per second, and 4096 tokens at that rate is more than two minutes. The default is therefore 300 s for hosted providers. It is 900 s for `ollama`, where a CPU at around 5 tokens per second needs about 820 s. A provider that never answers still stops the run within 5 minutes. Before this change, the run waited three attempts of 5 min 17 s each. A setting exists because only the user knows their hardware.

A timed-out call stops the run, through a new `RunStoppedError` subclass, `ModelCallTimeoutError`. The reason is the same as #125's: a call with no answer says nothing about the application. Treating it as a failed attempt would spend a step's retries at `timeout_s` each, and then fail the test for it. The message names `llm.timeout_s` and `BLASTPROOF_LLM_TIMEOUT_S` and says to raise it for a slow local model.

The SDK does not retry an aborted call, so `timeout_s` bounds the whole call, retries included. This is deliberate. "3 attempts" in #125's remedy is about errors that come back, not about waiting.

## D3. The deadline aborts a call in flight

`RunBudget` exposes the time left before its deadline, and `countedGenerate` aborts at the sooner of the two. It does this with one timer of its own, cleared when the call settles. The first version combined two `AbortSignal.timeout()`s with `AbortSignal.any()`. It passed every unit test and a short probe, and failed live: a run with `--max-duration 20` against a provider that never answered was still waiting after 200 s, past the 120 s timeout too. `any()` holds its sources weakly, and over a real run they were garbage-collected before they fired. With one timer held strongly, the same run stopped at 21 s for the deadline. After an abort, `budget.check()` runs first. If the deadline has passed, the stop is the deadline's `BudgetExhaustedError`, and `--max-duration` means what it says. Only otherwise is it a timeout.

## D4. SIGTERM and SIGHUP exit

Playwright registers its own handlers when a browser launches. For SIGINT, it closes the browser and exits 130. For SIGTERM and SIGHUP, it only closes the browser. A listener being registered disables Node's default exit, so a pending fetch then keeps the process alive. `cli.ts` installs handlers that call `process.exit(143)` and `process.exit(129)`. Playwright's `exit` handler kills the browser synchronously on the way out, so nothing is left running. No report is written. A cancelled job is not a result, and writing one would race the kill.

## D5. A call whose answer could not be used is counted (#136)

The output limit makes a cut-off answer an expected event. That answer arrives as `NoObjectGeneratedError` carrying its usage, and `countedGenerate` used to drop it, so a runaway's tokens never reached `--max-tokens` (#136). The usage is now recorded before the error goes on. It is the same line of code the limit's message is built on, which is why it is fixed here and not in a change of its own.
