## Context

The executor's `done` branch closes a step when `recovery.acted` is true and the step is not a verification step (`isVerificationStep`, a leading check verb). The `assert` branch sends the model's expectation to `brain.judge()` with the step, the page and the step's record, and re-observes once on a failed judgment. #172 records the gap between them: a step with an action first and a check after closes through the first branch.

## Decisions

### D1. Judge the `done`, do not refuse it

Two ways to make such a `done` reach the judge:

- **Refuse it**, as #139 does for a step that only verifies. The model answers again, normally with `assert`, and the judge decides. That costs a model turn and one failed attempt from the retry budget, on a step that may be finished.
- **Judge it.** The `done`'s reasoning is a claim about the page ("the first row now shows … Home Depot, Notes field, Food, and 12.34"), the same thing an `assert` expectation is. The executor sends it to the judge as the expectation.

Judging is chosen. It costs one judge call and no attempt unless the judgment fails, and the model is not asked to repeat itself in another form. A failing judgment is handled exactly as a failing `assert`: re-observe, judge again, then count one failed attempt and return the reason.

The `done` is rewritten into an `assert` whose expectation is its reasoning, and falls through to the `assert` branch, so the two cannot drift: the re-observation, the masking, the `usedEarlier` set and the handling of a malformed judgment are one piece of code. The record still shows a `done`, with the judgment as its result.

### D2. What counts as a verification clause

A check verb after the step's first clause, introduced by `and`, `then`, a comma or a semicolon: `/(?:\band\b|\bthen\b|[,;])\s+(?:verify|check|confirm|ensure|assert|expect|validate|make\s+sure|see\s+that)\b/i`. It uses the verb list `LEADING_CHECK_VERB` already uses, held in one constant so the two cannot drift. Quoted text is removed first, because a quoted name is the page's words: `click the "Save and check" button` has no check in it.

The ways this can be wrong:

- **A step it takes for a check that is not one.** "click Save and check the "Remember me" box" names an action with the verb `check`. Its `done` is judged against the step, and the judge decides the state the step asks for (`judge-the-outcome-not-the-means`): the box checked. That is a judgment that should pass. If it fails, the step fails visibly, as with #139.
- **A check it misses.** It closes on `done` as it does today. No new false PASS.

### D3. Setup steps

Setup steps follow the same rule, as they do for #76: everything after a setup step depends on the state it was meant to establish.

## Measurement plan

- Unit tests: a `done` on a clause step is judged, its pass closes the step, its fail counts one attempt with the judge's reason, a re-observation happens on a failed first judgment; a `done` on an action-only step still closes without a judgment; #139's refusal is unchanged.
- The notes test on the demo app with `gpt-6-luna`: 5 of 5 unjudged before; after, the record shows the judgment, and the test still passes.
- The reliability benchmark on the reference pair: false FAIL and false PASS rates, and the change in calls.
- The budgeting app's suite in CI: 21 of 21 before; the 4 unjudged steps are judged after.
