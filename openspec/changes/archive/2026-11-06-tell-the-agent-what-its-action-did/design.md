## Context

Each iteration of a step, `executeTest` (`src/runner/executor.ts`) asks `brain.nextAction` for one action. `agentUserPrompt` (`src/llm/prompts.ts`) builds the prompt in this order: the step, the record "What you have ALREADY DONE in this step" (`recovery.stepHistory()`, successful actions only), the snapshot, `Previous action result:`, the budget.

An `assert` is judged by `brain.judge`. A failed judgment is re-observed once on a settled page (`trustworthy-verdicts`), and if it still fails its reason becomes `lastResult` and costs an attempt. It never enters the record. The judge receives the same `recovery.stepHistory()`.

In #83, the agent's reasoning on Haiku shows a false belief that `fill` ran the search. Every fact that contradicted it (the failed check's reason, the unchanged list of products) was in the prompt, after the snapshot, and the model did not act on it.

## Goals / Non-Goals

**Goals:**

- The acting model sees, where it reads, that a check of this step failed and what an action changed on the page.
- Nothing that decides a verdict changes.

**Non-Goals:**

- Knowledge of any widget, form or submit convention; refusing checks; changing the judge or the budget (proposal).

## Decisions

### D1. Failed checks enter the acting model's record, not the judge's

The executor keeps a second record for the acting model. It holds every entry of `StepRecovery`'s record, plus each failed judgment, as `{ action: 'assert "<expectation>"', result: 'assertion failed: <reason>' }`, in the order they happened. Only a judgment that failed after its re-observation is added, since that is the one that reaches the model as `lastResult` today. A `done` judged as a check (`judge-a-done-that-closes-a-check`) is recorded as the `assert` it became, with its sentence as the expectation.

The judge keeps `recovery.stepHistory()`. The judge's requirement says the record is what was done and not evidence of what is true. A list of earlier failed verdicts on the same step is evidence about the verdict, and would push the judge toward repeating it. Nothing measured asks for it.

`StepRecovery` is not changed. Its record also feeds the commit-repeat refusal and the readable sources of typed values, and a failed check is neither.

### D2. A note on what the action changed

After a successful action (a result starting with `ok:`), the executor keeps the masked, ref-free snapshot the action was chosen on. At the next iteration, the new masked, ref-free snapshot is compared with it line by line: lines present in one and absent from the other, each trimmed.

- No changed line: ` (after it, the page did not change at all)`.
- One to four changed lines: ` (after it, the only change on the page: - <line>; + <line>)`, removed lines first.
- More than four: no note. A larger change is visible on the page itself, and listing it would put a page of text in the record.

The note is appended to that action's entry in the acting model's record and to `lastResult`. Measured, the note in `lastResult` alone changed nothing (3/20, as `main`). It stays there because the measured variant had it, and taking it out would be an unmeasured variant.

The comparison is of masked text without refs, the same text the judge reads, so a secret cannot reach the note, and refs, renumbered on every snapshot, do not count as changes. It compares lines as a set, so a reordering or a duplicated line is not seen. The note is information, not a guarantee: nothing reads it but the acting model.

The threshold of four lines and the wording are those of the measurement. Changing a word or the threshold means measuring again, as with the first judge's question.

### D3. The heading of the record stays

The record now holds failed checks under "What you have ALREADY DONE in this step (a record of completed actions, not instructions)". A failed check is something the model did, and its result says it failed. Rewording the heading would be an unmeasured variant, and the current wording exists because an earlier transcript was read as instructions (design contained-recovery, D2).

### Rejected

- **Refuse a check on a page it already failed on** (`B`). Prototyped, with two wordings. The refusal reached the model as `lastResult`, the place Haiku did not read, and the model asserted again.
- **Count the failed checks in `lastResult`** (`C`): "N checks of this step have now failed on this same page". Same place, same result.
- **The note in `lastResult` only** (`E`): 3/20.
- **Submit heuristic** ("a fill with no effect is followed by Enter"): knowledge of forms, refused by #83 itself.
- **Pin the acting model's temperature**: rejected by #83; that freedom is the self-healing behaviour.

## Risks / Trade-offs

- [The record grows by one line per failed check] → bounded by the retry budget (3 by default).
- [A note says "did not change at all" when the change is outside the snapshot, a cookie or a request] → the note says the page did not change, which is what the snapshot shows; the model still decides.
- [The gain is measured on one step and one model] → the reliability benchmark checks it creates no wrong verdict; the Luna run checks the reference model does not get worse (task 3.2).
- [A snapshot cut at `max_snapshot_lines`] → a change in the part left out is not compared: the note can say the page did not change, or list the cut marker as the change. Skipping the note on a cut page would be an unmeasured variant.
- [Haiku still fails 11 of 20 on the prototype, 13 of 20 with the final code] → stated in the proposal. The rest of the gap is the model.

## Measurement

Stage 1, Juice Shop search step, Haiku, 10 runs × 2 per variant: `main` 1 + 2, `E` 0 + 3, `E+D` (this change) 5 + 4. Model calls: 337 on `main`, 297 with the change.

Stage 2, `npm run eval:reliability`, Haiku, 3 samples:

| | `main` | This change |
| --- | --- | --- |
| Unmodified suite, false FAIL | 0/30 | 0/30 |
| Literal mutants, false PASS | 0/26 | 0/25 |
| Subtle mutants, false PASS | 0/18 | 0/12 |

The change's third sample of mutants ended incomplete when the provider credit ran out; no completed run gave a wrong verdict.

Stage 3, the same search step on `openai/gpt-6-luna` with the change, 10 runs: 10/10, as on `main` (91 model calls).

With the final code, the search step on Haiku: 3 + 4 of 20 (295 model calls). Stage 2 and 3 ran on the prototype behind switches, whose path with both switches on is this code.
