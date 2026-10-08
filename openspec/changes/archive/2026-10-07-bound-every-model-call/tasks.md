# Tasks: bound-every-model-call

## 1. Output limit (design D1)

- [x] 1.1 `countedGenerate` passes `maxOutputTokens: 4096` on every call. `GenerateObjectFn` carries it. Verify with a stub that records the options of each call shape
- [x] 1.2 A `NoObjectGeneratedError` with `finishReason: 'length'` becomes a malformed answer whose message names the limit. Verify with a stub throwing one: a failed attempt, not a stop

## 2. Timeout and deadline (design D2, D3)

- [x] 2.1 `llm.timeout_s` in the config schema (positive number), with defaults of 120 and 600 for `ollama`, and `BLASTPROOF_LLM_TIMEOUT_S`. Verify with config tests, including an invalid value
- [x] 2.2 `RunBudget.remainingMs()`, undefined without a deadline. Verify with the injectable clock
- [x] 2.3 `countedGenerate` passes an abort signal for the sooner of the timeout and the deadline. On abort, the deadline wins if it has passed (`BudgetExhaustedError`), otherwise `ModelCallTimeoutError`. Verify with stubs that wait on the signal
  - *One timer, not `AbortSignal.any()`* (design D3): the first version passed these tests and failed live. A test with fake timers checks that the timer is cleared when the call settles, and fails if `clear()` is removed
- [x] 2.4 `ModelCallTimeoutError extends RunStoppedError`, with the message D2 describes. Verify the run reports it as incomplete, like a refusal

## 3. Signals (design D4)

- [x] 3.1 `cli.ts`: SIGTERM exits 143, SIGHUP exits 129
- [x] 3.2 Live: the hang provider with `--max-duration 20` stops at about 20 s with the deadline. Without a deadline and with `BLASTPROOF_LLM_TIMEOUT_S=15`, it stops at about 15 s with the timeout. SIGTERM mid-call exits 143 with no Chromium left
  - *Done.* Deadline: exit 1 after 21 s, `deadline exceeded … 20s`. Before this change it was still waiting after 30 s. Timeout: exit 1 after 16 s, with the `llm.timeout_s` message. SIGTERM mid-call: exit 143 in 17 ms, no Chromium left. SIGHUP: exit 129

## 4. Docs and verification

- [x] 4.1 `docs/configuration.md`: `llm.timeout_s` and the output limit
- [x] 4.2 Live: the dogfood suite on Haiku and Luna, unchanged results
  - *Done.* 8/8 PASS on both, exit 0. Every request carried `max_tokens: 4096`
- [x] 4.3 Live: an open-weight model through the routing proxy. Runaways end at the limit as attempts, not at the 5-minute timeout
  - *First run, 120 s default:* `gpt-oss-20b` passed 7 tests, with 5 runaways cut at 4096 tokens and recovered. Then one call outlived 120 s and stopped the run. The default was raised (design D2)
  - *Second run, 300 s default:* **8/8 PASS, exit 0**, 97 calls, 1 runaway cut at the limit and recovered. Before this change, in the triage, no open model finished the suite
- [x] 4.4 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 4.5 Archive in the same pull request, as its own commit
