# Tasks: stop-the-run-when-the-provider-refuses

## 1. The stop (design D1, D2)

- [x] 1.1 `budget.ts`: `RunStoppedError` as the base of `BudgetExhaustedError` and a new `ProviderRefusedError` carrying `statusCode`. Verify with unit tests: both are `RunStoppedError`, and `BudgetExhaustedError`'s fields and message are unchanged
- [x] 1.2 `countedGenerate` converts an `APICallError` with no status or a status ≥ 400, or a `RetryError` whose `lastError` is one, into `ProviderRefusedError`, after `withProviderDetail`. Verify with brain tests using a stub `generate`: 401, 402, 429, 503 and no status become the stop; a 2xx `APICallError`, `NoObjectGeneratedError` and a plain `Error` do not; a `RetryError` wrapping a 503 does
- [x] 1.3 Every `instanceof BudgetExhaustedError` in `src/` tests `RunStoppedError` instead, and `incomplete`/`stoppedBy` take that type. Verify with a grep, in a test, that no `instanceof BudgetExhaustedError` remains in `src/`
  - *The guard lives in `tests/budget.test.ts`*

## 2. The reason (design D3)

- [x] 2.1 The message gives the status, the provider's detail and the remedy from D3's table. Verify with unit tests, one per status class
- [x] 2.2 The console line for tests not run gives the stop's reason instead of naming the budget. Verify with a run test
  - *`plan`'s "Not attempted (run out of budget)" assumed the cause too, and now reads "Not attempted (run stopped)". Its `Stopped:` line already gave the reason*

## 3. The callers (design D4, D5)

- [x] 3.1 Executor: a refusal from `nextAction` or from the judge is rethrown, not counted as an attempt. Verify with executor tests for both
- [x] 3.2 Login: a refusal during the journey makes the run incomplete, with every selected test not run and no `AuthError`. Verify with a run test
- [x] 3.3 A refusal during a test makes it and every later test not run, keeps earlier results, and exits 1 whatever `--min-score` is. Verify with a run test, serial and concurrent
- [x] 3.4 `plan`: a refusal stops it the way a budget stop does. Verify with a plan test

## 4. Verification

- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 4.2 Mutation check: classify by message instead of status; drop the conversion; leave one site on `BudgetExhaustedError`. Each must turn a test red
  - *Done.* Classifying by message turns `decides on the status, never the message` red. Dropping the conversion turns 11 tests red. Leaving `auth.ts` on `BudgetExhaustedError` turns three red: the guard, the auth unit test and the run-level login test
- [x] 4.3 Live, against `examples/demo-app` with the fake provider answering 401, 402, 429, 503, and with no server listening: the run is incomplete each time, exit 1, no test reported failed, and the reason matches D3. Record the 402 output here beside the reproduction
  - *Done 2026-10-04, full demo-app suite, whose config has a login:*
    - *401 and 402:* exit 1, 8 of 8 `NOT RUN`, none `FAIL`. Before, the 402 gave `Authentication failed at step "navigate to /login"`, exit 2. It now reads `8 test(s) not run (run stopped: model provider refused the request (HTTP 402): This request requires more credits… Add credit to the provider account, then run again.)`, then `Run incomplete:` with the same reason
    - *429 and 503:* the same outcome after 8 s, because the SDK retried twice with backoff before the error reached the run
    - *No server listening:* the existing preflight refuses before anything runs, exit 2, as before. "No response" mid-run is covered by the brain unit test, since a live provider that answers preflight and then stops answering cannot be staged reliably here
    - *Seen, unchanged by this change:* an incomplete run with nothing executed prints `Score over executed tests: 100`, the same as a budget stop during login
- [x] 4.4 Live, the dogfood suite against a real provider: no regression
  - *Done in the `dogfood.yml` pipeline on this branch (run 37212344984), because Node here could not reach OpenRouter (`ETIMEDOUT`) while `curl` could: 8 of 8, Score 100, 93 model calls*
- [x] 4.5 Docs: `docs/configuration.md`, where it describes `not run` and the exit for a stopped run, and `docs/ci.md`'s exit codes, say a provider refusal stops a run the same way
  - *Also `README.md`'s exit codes, and the budget convention in `AGENTS.md`*
- [x] 4.6 Archive in the same pull request, as its own commit
