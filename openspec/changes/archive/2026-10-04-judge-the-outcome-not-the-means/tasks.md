# Tasks: judge-the-outcome-not-the-means

## 0. The corpus

- [x] 0.1 Three FAIL controls in `evals/judge/cases/issue-121.json` (design D6), snapshots captured from Juice Shop, `reconstructed`, citing this design. Verify `tests/judge-corpus.test.ts` passes, and that the current judge gets each right 3/3
- [x] 0.2 File an issue for the modal path (design D7), quoting its reasons and the two wordings that did not move it. Re-mark `121-already-dismissed-run1-1`, `-run1-2` and `-run2-4` to it
  - *Filed as #129; the three cases are marked `knownFailing: #129`*

## 1. The judgment (design D1–D3)

- [x] 1.1 `assertJudgmentSchema` is `outcome`, `reason`, `pass`, with the descriptions in D1 and D2. `secretMismatch` keeps `outcome` in the judgment it returns. Verify with a schema test: property order is `outcome`, `reason`, `pass`, and `pass`'s description says an action is not part of the outcome and an absence is shown by absence
- [x] 1.2 The judge's system prompt carries D3's paragraph after the ACTION paragraph. Verify with a brain test that the paragraph is in the prompt
- [x] 1.3 Every existing judge, executor and auth test passes, updated only where it pinned the old field order or descriptions
  - *The exported `AssertJudgment` keeps `outcome` optional, since nothing downstream reads it and the executor and auth fakes build judgments without one. The schema the model answers to requires it. Updated: the model stubs in `brain.test.ts` and `schemas.test.ts`, which now must carry an outcome, and the D2 test that pinned the order to exactly `reason`, `pass`*

## 2. Measurement

- [x] 2.1 `npm run eval:judge`, 3 samples: no regression; `121-already-dismissed-run1-0` and `-run3-6` right 3/3 and their markers removed; the three controls right 3/3
  - *Done 2026-10-03, `anthropic/claude-haiku-4.5`:* 36 cases, 33 right 3/3, the three marked #129 wrong 0/3. Exit 0
- [x] 2.2 Replace D1's dismissal example with one that is not a dismissal, and re-run 2.1. Keep it if 2.1 still holds, and record either outcome here
  - *Kept.* With *"open the Account menu and verify it shows the email"* the result is identical: 33 right 3/3, the #129 three 0/3
- [x] 2.3 Mutation check: drop `outcome`; drop D2's two sentences; drop D3's paragraph. Each must turn a unit test red, and the corpus result of each is the D4 table row
  - *Done.* Dropping `outcome` turns five tests red, dropping D2's sentences one, and dropping D3's paragraph one, each the test written for it
- [x] 2.4 Live, the dogfood suite against `examples/demo-app`: no regression
  - *Done.* 8 of 8, Score 100, 93 model calls
- [x] 2.5 Live, the QA tests against Juice Shop, 5 runs: no run fails on a consent dialog that is already gone with the login-page reason. The test built to fail for #120 never passes
  - *Done 2026-10-03.* The #120 harness plus one test reproducing #121 directly: it dismisses the consent dialog, goes to `/#/login`, and asks to dismiss it again. 5 runs each:
    - *already-gone, `main`:* the test passed all 5 times. The step's first judgment failed in 4 of 5 runs, with 6 wrong FAILs in all (*"no cookie consent dialog … cannot be verified"*), and each run got through only by asserting again. That is the non-determinism #121 reports.
    - *already-gone, this change:* passed all 5 times, every time on its first judgment, with no wrong FAIL.
    - *The test built to fail (#120):* failed all 5 times at its last step, for the right reason: the menu shows `[redacted TEST_EMAIL]`, not `[redacted TEST_OTHER]`. The model reached that by itself in 2 runs, and D5's label check in 3. It passed its own consent-dialog step every time.
    - *Its control:* passed all 5 times.

## 3. Documentation

- [x] 3.1 `skills/blastproof/references/authoring.md`: a row in the enforcement table saying a step's means is not checked, and that a step whose means matters names what it leaves on the page. Verify `tests/skill-manifest.test.ts` passes
- [x] 3.2 `AGENTS.md`: the judge-corpus convention lists this change beside `ask-the-judge-about-the-step`
- [x] 3.3 `CHANGELOG.md` entry
  - *Left to the release commit.* The CHANGELOG has no Unreleased section: `RELEASING.md` writes the entry in the release commit, as it did for #124

## 4. Verification

- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 4.2 Archive in the same pull request, as its own commit, and fix the archive path cited by the controls if the date differs
  - *Archived 2026-10-04. The controls and `AGENTS.md` cite that path*
