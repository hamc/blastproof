## 1. Reproduce the duplicate write first

- [x] 1.1 Add to `examples/demo-app` the shape no existing page produces: a form whose `POST` is answered with a real server-side delay and a `302` back to **its own page**, with server-held state and the form reset. The submitted entries must be listed on that page, so a duplicate is visible as a second row rather than inferred.
- [x] 1.2 Write a test whose step names the action without stating the outcome — the shape #28 and both reproductions used — and run it against a real model.
- [x] 1.3 **Confirm the duplicate against the demo app's own state, not the tool's report**: two entries where the test intended one. If it will not reproduce, say so plainly rather than tuning the test until it does — a reproduction adjusted until it fails proves nothing, and a defect that will not reproduce changes what this change should be.
- [x] 1.4 Capture the exact log: the successful commit, the failed judgment, and the repeat. Note whether the model invents a field value, and what it invents.
- [x] 1.5 Report before continuing. Write no fix in this group.

### Findings

Both shapes reproduced on the demo app's new notes page, first attempt, with `anthropic/claude-haiku-4.5`:

- **Negative test** (`submit the add-note form` with the field empty, intended outcome: nothing happens) — **1 note written**, named `This is a test note`. Invented.
- **Positive test** (`submit the add-note form`, intended: one note) — **2 notes written**: `Check the invoice` from the test, and `Test note`, invented.

In both, the write was a verbatim repeat of `click button "Add note"`, confirming D1's premise against a third application. Counts read from `GET /notes`, not from the report.

## 2. The executor refuses a repeated commit

- [x] 2.1 `src/runner/executor.ts` keeps, per step, the actions performed successfully in that step. Identity is action + target role + target name + target text + **unresolved** value, so a `{{env.*}}` placeholder compares as written and no substituted secret is retained (design D1).
- [x] 2.2 The record is created per step and reset at the step boundary — not per test, not per run.
- [x] 2.3 An incoming `click`, or a `press` of a key that activates a control, matching the record is not performed. `navigate`, `fill`, `select` and `assert` are unaffected (design D1: only the commit actions, and why). Guarding every `press` was tried first and broke a legitimate repeated-`Tab` step — hence `COMMIT_KEYS`.
- [x] 2.4 The refusal becomes that turn's `lastResult`, phrased so the model learns it already performed this action successfully in this step and that it was not repeated, and is emitted as the action's result so it appears in logs and reports.
- [x] 2.5 A refusal counts as one failed attempt, so a model that insists terminates on the existing budget rather than running to the 15-action ceiling.
- [x] 2.6 The guarantee holds over the whole step, in one place, not as a check bolted onto the point where an action is performed — this project's recurring defect is exactly a guarantee written at one call site instead of over its scope.
  - **Scoped to recovery first, and the reproduction disproved it.** The original version refused a repeat only after a judgment had failed. Re-run against the reproduction, the model went `click` → `fill` → `click` with no assertion between them, no judgment ever failed, the guard never applied, and the duplicate note was written exactly as before. The condition was removed (design D1). This is the second time in this change that shipping the unit tests alone would have shipped nothing.

## 3. The model sees what it already did in this step

- [x] 3.1 `AgentIterationInput` in `src/llm/prompts.ts` carries the successful actions of the current step with their results; `agentUserPrompt` renders them, plainly labelled as a record of what was done, above the snapshot (design D2).
- [x] 3.2 `src/llm/brain.ts` passes it through; `src/runner/executor.ts` supplies it.
- [x] 3.3 Every value in the record crosses the mask, on the same boundary as the snapshot and `lastResult`. Check this at the point the record is built, not only where it is rendered.
- [x] 3.4 (verified: dogfood login passed, and the model cited the record — *"as confirmed by both the action record and the current snapshot"*) **Verify the login journey against a real model.** An action transcript in a prompt broke working logins once before (`src/auth.ts`, design D2 "Known risk"); the unit suite did not catch it and will not catch this. Run an authenticated test end to end before calling this done.

## 4. Do not invent a field value

- [x] 4.1 `agentSystemPrompt` states that a value must come from the step, from the page, or from an `{{env.*}}` placeholder, and that a step needing a value it never supplies is a failing step (design D3).
- [x] 4.2 Keep it as one rule alongside the existing "never invent elements", not a new paragraph of policy. It is supporting, not load-bearing: D1 must hold whether or not the model honours it.
  - **It did not hold.** With the clause in place the model still filled `Test note` in the verification run. Harmless only because D1 refused the commit that would have written it. Recorded in design D3 as evidence for DEF-005's rule about reaching for prompt clauses.

## 5. Tests

- [x] 5.1 A commit repeated after a failed judgment is refused, and the refusal reaches the model as the action's result.
- [x] 5.2 The same commit repeated with **no** failed judgment in the step is still refused — the case the first, narrower scoping got wrong.
- [x] 5.8 A repeated navigation key (`Tab`, `Escape`) is performed; a repeated `Enter` is refused.
- [x] 5.3 A repeat in a later step is performed — the record does not cross step boundaries.
- [x] 5.4 `navigate` and `fill` repeated during recovery are still performed.
- [x] 5.5 An action carrying `{{env.*}}` is recorded and compared unresolved, and the record never holds the substituted value.
- [x] 5.6 Repeated refusals exhaust the retry budget and fail the step, rather than looping to the iteration ceiling.
- [x] 5.7 The step history reaching the prompt is masked.

## 6. Verification against the reproduction

- [x] 6.1 Re-run the reproduction from group 1 with a real model. The badly-written step may still fail — that is correct and expected — but the demo app must hold **one** entry, not two.
  - Negative test: **0 notes** (was 1). Positive test: **1 note**, `Check the invoice` only (was 2). Both steps still fail, correctly. A well-written version of the same test passes with Score 100 and one note, with the refusal visible in the trace steering the model from a second submit to a verification.
- [x] 6.2 Run the dogfood suite and confirm no regression in what already passes. — 6 passed, 0 failed, Score 100, login journey included.
- [x] 6.3 Confirm the residual risk stated in design D1 is what the release notes claim: "recovery no longer repeats a commit it already performed", never "no duplicate writes".
