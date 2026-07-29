## 1. The budget itself

- [x] 1.1 Add `src/runner/budget.ts` with a `RunBudget` holding optional `maxCalls`, `maxTokens`, `maxDurationMs`; a `start` timestamp; running counts; a `check()` that raises when the *next* call could exceed a limit; and a `record(usage)` for what a completed call spent.
- [x] 1.2 Add a distinct `BudgetExhaustedError` carrying which limit was reached and the observed counts, so callers can tell it apart from a step failure.
- [x] 1.3 Unit-test each limit independently, the unconfigured case (never binds), and that the message names the limit and the count.

## 2. Enforcement at the single choke point

- [x] 2.1 In `src/llm/brain.ts`, accept an optional budget and wrap the `generate` call: `check()` before, `record()` after, using the `usage` the AI SDK already returns and we currently discard. Both `createBrain` and the planner brain go through it.
- [x] 2.2 Test that the planner is counted too — a budget that only covered `run` would repeat the class of defect that produced #15 and the secret leaks.
- [x] 2.3 Test that a call which would exceed the budget is never issued, rather than issued and then rejected.

## 3. Configuration and flags

- [x] 3.1 Add an optional `budget` section to `src/config.ts` (`max_llm_calls`, `max_tokens`, `max_duration_s`), all optional, absent meaning unbounded.
- [x] 3.2 Add `--max-llm-calls`, `--max-tokens`, `--max-duration` in `src/cli.ts`, overriding config; non-positive or non-numeric is `EXIT_USAGE`.
- [x] 3.3 Wire into `ENV_OVERRIDES` for consistency with the existing precedence (flag > env > file).
- [x] 3.4 Tests for precedence and for the invalid-value path.

## 4. The incomplete outcome

- [x] 4.1 Introduce `not run` as a third test state, distinct from passed and failed, for tests the run never reached.
- [x] 4.2 In `src/commands/run.ts`, catch `BudgetExhaustedError`, stop the run, mark the remaining selection as not run, and check the deadline between tests as well as between calls.
- [x] 4.3 Make an incomplete run exit 1 unconditionally, including when `--min-score` is given and the executed tests would satisfy it.
- [x] 4.4 Exclude unexecuted tests from the score denominator rather than counting them as failures — treating them as failures would replace one lie with a quieter one.
- [x] 4.5 Tests: partial run does not report success; threshold does not rescue it; score arithmetic over a partial selection.

## 5. Reporting

- [x] 5.1 `src/report/junit.ts`: unexecuted tests as `<skipped/>` with a reason naming the limit, and the run marked incomplete.
- [x] 5.2 `src/report/html.ts`: a visible banner stating the run was stopped and which limit was reached, with unexecuted tests distinguished from failed ones.
- [x] 5.3 Console summary states the stop and the limit rather than printing an ordinary score line.
- [x] 5.4 Tests for all three surfaces.

## 6. The dry-run ceiling

- [x] 6.1 Compute the worst-case model-call count for a selection: steps times the per-step iteration ceiling, plus judgments.
- [x] 6.2 Print it in `--dry-run`, labelled explicitly as a maximum and not a prediction.
- [x] 6.3 Test the arithmetic against a known selection.

## 7. Verification

- [x] 7.1 `npm run build`, typecheck, full vitest suite green.
- [x] 7.2 Dogfood with a deliberately tiny budget: the run stops, exits 1, reports incomplete, and names the limit.
  - Verified on `fix/run-budget-and-deadline`, run `30473778580` with `max_llm_calls=20`: 1 passed, 4 not run, `Run incomplete: model call budget exhausted: reached the configured maximum of 20 call(s)`, `Score over executed tests: 100 (not a verdict — exit code 1 regardless of --min-score)`, exit 1.
- [x] 7.3 Dogfood with no budget configured: unchanged behaviour, score 100, exit 0. An inert default that turns out not to be inert is the worst outcome of this change.
  - Verified on the same branch, run `30473914460` with no budget: `Score: 100 — min-score 80: pass`, 5 passed 0 failed, no incomplete or not-run output, exit 0. The default is genuinely inert.

## 8. Documentation

- [x] 8.1 README: the budget section, what an incomplete run means, and that limits are counted in calls and tokens rather than currency, with the reason.
- [x] 8.2 `AGENTS.md`: note the budget as a run-wide guarantee enforced at the brain, alongside the mask.
- [x] 8.3 CHANGELOG entry under Unreleased.
- [x] 8.4 Update issue #2 to record that the budget and deadline half is done and that it stays open for worker parallelism.
