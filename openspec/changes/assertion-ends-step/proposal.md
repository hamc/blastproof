## Why

A passing assertion does not end the step: the executor records it and loops, so the model gets another turn and `fail` is still legal. The model can fail a step it has just proved succeeded.

Measured over twenty dogfood runs against an unchanged tree and app: **three failures, 15%**, all this defect on the same step shape. The other four tests failed zero times in nineteen runs each, so this is one hole, not diffuse instability. A gate that blocks a good pull request one run in seven gets marked non-required, which makes every other capability on the backlog worth less than this one.

## What Changes

- A passing assertion terminates its step as complete. The executor stops asking for further actions.
- **BREAKING** (behavioural, not API): `done` is no longer required after a passing assertion, and `fail` can no longer follow one within the same step.
- A step whose assertion failed keeps today's behaviour exactly: retry within the budget, fail when exhausted.

Evidence that this is safe rather than merely simpler: in the observed runs, every repeated assertion re-confirmed an already-passing expectation in different words, then emitted `done`. No step used a second assertion to check a *different* condition, so nothing is truncated. One step spent three judge calls plus a `done` where one call sufficed — so this also removes roughly a third of the model calls in a run, cutting cost and wall-clock alongside the defect.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agentic-execution`: the per-step loop terminates on a passing assertion; the assert judgment scenario gains the terminal outcome, and `fail` after a passing assertion is no longer reachable.

## Non-goals

- **Not** downgrading a later `fail` to `done` on the strength of an earlier assertion. That was the first instinct and it is dangerous: if an intermediate expectation passes and the step then genuinely breaks, the downgrade produces a false PASS. A gate that approves broken code is worse than one that blocks good code.
- Not touching the retry budget, self-healing, or the failed-assertion path.
- Not changing the action vocabulary. `done` stays valid for steps that end without an assertion.
- Not prompt wording. The fix is a loop termination condition, enforced by the executor — consistent with the house rule that a guarantee is defined over a scope, not asked for in a prompt.

## Impact

- `src/runner/executor.ts` — the assert branch, where a passing judgment currently continues the loop.
- `openspec/specs/agentic-execution/spec.md` — modified requirement and scenarios.
- `tests/executor.test.ts` — a regression test that a `fail` offered after a passing assertion cannot fail the step.
- Reporting is unaffected: step outcomes and screenshots keep their shape.
- No new npm dependency.
