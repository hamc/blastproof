# Tasks: ask-the-judge-about-the-step

## 0. The regression corpus first (design D4)

Built and run against the current judge before anything else changes, so its baseline is recorded by the judge it is meant to protect.

- [x] 0.1 `evals/judge/` holds one JSON file per incident, each case with step, expectation, snapshot, record, correct verdict, issue, provenance (`captured` or `reconstructed`, with its source) and an optional `known_failing` issue. Verify with a vitest test that every case is well-formed, and that no case contains an email address or any credential value used to capture it
- [x] 0.2 Cases: the 19 distinct inputs captured from the Juice Shop runs (#120, #121, controls), plus two step-2 judgments as further controls (the welcome banner absent from `/#/login`, so PASS is right); #87's true and false assertions; #112's demo-app page before #113; #31's two wrong PASSes, reconstructed from `judge-the-step`'s design (#32's rationalised `ok` is left out: its correct verdict depends on a mid-request page the design does not record); #35's cross-host redirect, reconstructed from `judge-sees-the-record`'s design. Verify every reconstructed case cites the archived passage it was built from
- [x] 0.3 `npm run eval:judge` replays every case through the real `judge()`, 3 samples each, and exits non-zero when a case not marked `known_failing` is judged wrong in any sample; it reports a `known_failing` case that now passes. `evals/**/*.ts` is typechecked. Verify by running it with a stub generate that returns a fixed verdict, in a vitest test, for both exit paths
- [x] 0.4 Run it against the current judge and record the baseline here. Mark as `known_failing` exactly the cases the current judge gets wrong, each with its issue
  - *Baseline, 2026-10-03, `anthropic/claude-haiku-4.5`:* 26 cases, 18 right in 3/3 samples, 8 wrong in 3/3 and marked `knownFailing`: the two placeholder-vs-label inputs and one weakened-expectation input (#120), five already-dismissed inputs (#121). `npm run eval:judge` exits 0. Every other incident's cases (#31, #35, #87, #112) and every control pass
  - One planned control was dropped. Its snapshot was a first judgment taken while the cookie dialog was still closing: the step (the welcome banner) holds, the executor's expectation (the cookie dialog gone) does not, and the live run passed it only on re-observation. No one has reported either verdict as a defect, so labelling it would have meant choosing the answer rather than recording it. The case taken from its re-observation stays

## 1. Placeholders as labels (design D1)

- [x] 1.1 `env.ts` exports a helper that rewrites every `{{env.NAME}}` as `redactionLabel(NAME)`, using `ENV_PLACEHOLDER`. Verify with unit tests: one and several placeholders, the spaced form `{{ env.NAME }}`, text with none unchanged, and a value that is not a placeholder untouched
- [x] 1.2 `judge()` applies it to the step, the expectation and each record entry before building the prompt. Verify with a brain test using a stub `generate` that captures the prompt: no `{{env.` reaches it, and the labels do
- [x] 1.3 The executor's prompt is unchanged. Verify with an executor test that a fill step's prompt to `nextAction` still contains `{{env.TEST_PASSWORD}}`
  - *Done in `tests/brain.test.ts`, on `nextAction`, which is the one place the executor's prompt is built. Same guarantee, one layer more direct*

## 2. The schema asks about the step (design D2)

- [x] 2.1 `assertJudgmentSchema` is `reason` then `pass`, with the descriptions in design D2. Verify with a schema test: the JSON-schema property order puts `reason` first, and `pass`'s description names the step and not the expectation
- [x] 2.2 Every existing judge, executor and auth test passes, updated only where it pinned the old description or field order

## 3. Verification

- [x] 3.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 3.2 Mutation check: skip the placeholder rewrite; restore the old `pass` description; restore `pass` before `reason`. Each must turn at least one test red
  - *Done.* Each of the three turns exactly one test red, the one written for it
- [x] 3.3 `npm run eval:judge` against the changed judge. Verify that the #120 cases are no longer failing (their `known_failing` markers removed), that every other case not marked `known_failing` still passes, and that the #121 cases are unchanged
  - *Done 2026-10-03.* Exit 0. The three #120 cases marked `knownFailing` were judged right 3/3 each and their markers are removed; the 18 cases right at baseline stay right; the five #121 cases stay wrong, as expected
- [x] 3.4 Live, the dogfood suite against `examples/demo-app`: no regression
  - *Done.* 8 of 8, Score 100, 92 model calls
- [x] 3.5 Live, the two QA tests against OWASP Juice Shop, 5 runs: the test built to fail never passes. Record how often it fails for the right reason and how often #121 stops it first
  - *First attempt, after D1 and D2 only, 2026-10-03:* the test built to fail passed in 2 of 5 runs (runs 1 and 3), failed for the right reason in 2 (runs 2 and 5) and on #121 in 1. Not done; see section 5

## 5. The label check (design D5)

Added after 3.5 failed: with D1 and D2 the test built to fail still passed in 2 of 5 live runs (the judge called `[redacted TEST_EMAIL]` a match for `[redacted TEST_OTHER]`), against 3 of 5 before.

- [x] 5.1 Capture the judge inputs of fresh live runs against Juice Shop with a local, uncommitted hook, verdicts included, and add every judgment on this path to `issue-120.json`, right and wrong, so the corpus no longer has two inputs here. Verify the wrong ones are marked `knownFailing: #120` and `npm run eval:judge` exits 0 before 5.2
  - *Done, partly out of order.* A first capture lost runs 3–8 to an exhausted provider balance; one valid judgment from it was added as `knownFailing`. With credit restored, 6 live runs were captured on the final code, recording the model's own verdict before the label check: 6 new judgments on this path, 2 of them a PASS by the model alone (it read the step as if it named TEST_EMAIL). D5 was already implemented by then, so the "exits 0 before 5.2" ordering could not hold for these six; they are recorded with the model's verdict in their `note` instead
- [x] 5.2 After the model's verdict, `judge()` turns a PASS into a FAIL when the judged step names a label that is in neither the snapshot nor the judged record while the snapshot shows another label, with a reason naming both. Verify with brain tests: the captured case fails; a label present on the page passes; a label present only in the record passes; a page with no labels keeps the model's verdict; a FAIL is never turned into a PASS
- [x] 5.3 Mutation check: drop the record condition; drop the other-label condition; drop the check. Each must turn at least one test red
- [x] 5.4 `npm run eval:judge`: the markers added in 5.1 now pass and are removed; nothing else moves
  - *Done 2026-10-03.* 33 cases, exit 0: every #120 case right 3/3 (the last marker removed), nothing that was right moved, the five #121 cases still wrong as expected
- [x] 5.5 Then redo 3.4 and 3.5
  - *3.5, final code, 6 live runs against Juice Shop:* the test built to fail **never passed** (0 of 6, against 3 of 5 before the change and 2 of 5 after D1 and D2 alone). It failed for the right reason in 3 and on #121 in 3. In run 2 the model passed the step twice and the label check failed both; without it that run is a wrong PASS. The test built to pass passed 6 of 6
  - *3.4, final code:* dogfood 7 of 8, Score 90. The failure is the notes test, and it is not this change's: on `main` (e3cca05, built separately) the same test failed 4 of 5 in isolation today, against 3 of 5 with this change. Both sides show the same executor behaviour, refilling the note after submitting and clicking again, and the repeated click got through `contained-recovery` because its target carried `text="Add note"` the first did not, so the identity differed and a duplicate note was written. One run on this side had the judge fail the step because the refilled textbox still held the text; it did not occur in the five `main` runs, which is too few to call either way. Filed separately

## 4. Documentation

- [x] 4.1 `AGENTS.md`: a change to the judge runs `npm run eval:judge` before merging, and a new verdict incident adds its case to the corpus as part of its fix. Verify the line sits with the `judge-the-step` convention it extends
- [x] 4.2 `CONTRIBUTING.md`: what `eval:judge` is, that it needs a key, and that it is not part of CI
