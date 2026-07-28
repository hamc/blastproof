## Context

`src/runner/executor.ts` drives each step as a loop: snapshot, ask for an action, perform it, repeat. The `assert` branch judges an expectation and, on a pass, records the result and `continue`s. The loop then asks for another action, and `fail` is still in the vocabulary.

That extra turn is where the defect lives. The model, looking at a page where the step has plainly succeeded, reports `fail` — reasoning correctly that the action can no longer be performed and incorrectly that this means failure. It is not confused about the world, only about the word.

Measured: twenty runs, unchanged tree and app, three failures (15%), all of them this. Four of the five tests failed zero times in nineteen runs each.

The failure surfaces at two blast radii. Inside a test it costs one P0 and the score gate blocks correctly at 77. Inside `auth:`, `authenticate()` throws and the whole run aborts with exit 2 before a single test runs — no score, no report.

## Goals / Non-Goals

**Goals:**
- A step that has demonstrably succeeded cannot be failed.
- Remove the redundant turn, and with it a meaningful share of the per-run model calls.
- Keep the failed-assertion path — retry within budget — byte-for-byte as it is.

**Non-Goals:**
- Prompt wording. This is a termination condition in the executor, enforced by code.
- The retry budget, self-healing, or screenshot capture.
- Removing `done`, which remains how a step without an assertion ends.

## Decisions

**D1 — A passing assertion terminates the step.**

The assert branch breaks instead of continuing. Chosen over three alternatives:

- *Downgrade a later `fail` to `done` when an earlier assertion passed.* Rejected, and it was the first instinct. An assertion proves its own expectation, not the whole step. If an intermediate expectation passes and the step then genuinely breaks, the downgrade yields a **false PASS** — a gate approving broken code, which is strictly worse than the defect being fixed.
- *Make `fail` illegal after a passing assertion, then re-prompt.* Correct but wasteful: it spends a round trip to obtain an answer already known.
- *Match the reasoning text for completion phrasing.* Rejected on principle — string-matching a model's prose, in whichever language it emits.

**D2 — Safe because the evidence says so, not because it is simpler.**

The obvious objection is truncation: a step that asserts an intermediate condition and legitimately continues. Across the observed runs no step did this. Where a step asserted more than once, every repeat re-confirmed an already-passing expectation in different words before emitting `done` — one step spent three judge calls plus a `done` where one sufficed. Terminating on the first pass reaches the same outcome the model already reaches, minus the opportunity to contradict itself.

**D3 — The win is also economic.**

Every step currently pays for at least one redundant `nextAction` call after its assertion, plus any repeated judgments. On the demo suite that is roughly a third of the calls in a run. Cost and wall-clock improve as a side effect, but correctness is the reason.

## Risks / Trade-offs

- **A future step genuinely needs a second assertion after a passing one** → It cannot express that any more. Accepted: no observed step does, and the model reliably signals completion via `done` when it has more to do. If it appears, the step is better split in two — which reads better in a report anyway.
- **A model asserts a weak expectation that passes while the step is incomplete** → The step ends early and passes. This risk exists identically today, since the model already emits `done` immediately after such an assertion. Not made worse; not fixed here.
- **The 15% figure comes from one suite on one app** → The rate is specific to blastproof's own demo. The defect is not: any step whose success navigates away from the element it acted on can reach it.

## Migration Plan

Behavioural change only — no config, no API, no data. Existing suites keep passing; some get faster. Rollback is reverting the branch.

Closure requires re-measuring, not merely a green test: twenty dogfood runs against an unchanged tree, with the observed rate stated in the result. A unit test proves the branch; only the rate proves the gate.

## Open Questions

- Should a step that ends on a passing assertion be visually distinct in the report from one that ended on `done`? Leaning no — same outcome, and the distinction would leak executor mechanics into a user-facing artifact.
