## 1. Executor

- [x] 1.1 In `src/runner/executor.ts`, make a passing `assert` judgment terminate the step instead of continuing the loop: record the result, then break as `done` does. Leave the failing branch — retry within budget, `StepFailure` when exhausted — untouched.
- [x] 1.2 Add a comment naming the reason the branch terminates, so a later reader does not "simplify" it back into a `continue`: the extra turn is what let the model contradict its own passing assertion.

## 2. Regression tests

- [x] 2.1 In `tests/executor.test.ts`, add a test with a brain that returns `assert` (judged pass) and then `fail`: the step must pass and the `fail` must never be requested.
- [x] 2.2 Add a test that a failing assertion still retries to the budget and then fails the step, proving the failure path is unchanged.
- [x] 2.3 Add a test that a step ending in `done` without any assertion still passes, so the ordinary path is covered.
- [x] 2.4 Assert the call count: a step whose assertion passes makes no further `nextAction` call. This is the economic claim in design D3 and it should be pinned, not assumed.

## 3. Authentication path

- [x] 3.1 Confirm `authenticate()` inherits the fix through the shared executor, and add a test that a login journey whose assertion passes cannot then abort the run with `AuthError`. This is the blast radius that kills a whole run with no score and no report.

## 4. Verification

- [x] 4.1 Run `npm run build`, typecheck and the full vitest suite; all 248+ tests green.
- [x] 4.2 Re-measure: twenty dogfood runs against an unchanged tree, recording per run the gate conclusion and the `N passed, M failed` line. Serial — the workflow's concurrency group keeps only one queued run, so firing them at once silently cancels most.
  - Result: **20/20 clean** (score 100, 5 passed 0 failed each) on `fix/assertion-ends-step`. Ten further dispatches failed on exhausted LLM provider credits and are excluded: all ten died at the first step with `requires more credits`, none reached a passing assertion, so none carries a signal about this defect.
- [x] 4.3 State the observed rate in the change and in issue #15. A green unit test proves the branch; only the rate proves the gate.
  - **15% before (3/20) → 0% after (0/20).** Under the old rate, twenty consecutive clean runs has probability 0.85^20 ≈ 3.9%.

## 5. Documentation

- [ ] 5.1 Update `openspec/specs/agentic-execution/spec.md` via archive, not by hand.
- [x] 5.2 Add a CHANGELOG entry under Unreleased describing the behavioural fix and the measured before/after rate.
