# Tasks: refuse-the-same-submit-twice

- [x] 1.1 `StepRecovery`: a press takes the control it activates; repeat check, `performed` and `lastSuccess` use that control's click identity; a press on a button needs no lookup (design D1, D2)
- [x] 1.2 `StepRecovery`: the back-to-back exception does not hold on a page that came back reset (design D3)
- [x] 1.3 `actions.ts`: the default submit button of a field's form, from the press's target or the focused element, matched to a snapshot `button` line by ref; no control on any failure (design D2)
- [x] 1.4 `executor.ts`: ask for the control before `refusalFor`, pass it to `record`
- [x] 1.5 The Enter refusal names the button it stands for (design D4)
- [x] 1.6 Review round: a press is recorded as the click only when it clicked the button (D2a); the lookup follows Chromium on disabled, image and unknown-type buttons, checkboxes and a focused button (D2); a press with no key is Enter; `lastSuccess` keeps both identities; Enter on the next page of a form is performed (D6); unnamed fields decide nothing; the lookup is bounded and disposes its handles
- [x] 1.7 Second review round: an empty key is Enter in the lookup too; the next-page exception needs the earlier page gone, and is Enter only; a `submit` listener beside the `click` one; two presses the page named two buttons for are two controls; Space named in the refusal; the lookup's page object let go on a refused or failed press
- [x] 1.8 Third review round: a shared key joins no press to a button already activated, and no longer refuses a wizard's "Finish" after its "Continue"
- [x] 2.1 Unit tests: every scenario of the spec delta; the table in design D3; the known wrong refusals and the known miss of D5/D6 pinned; the existing tour, #124 and #28 tests unchanged
  - *Done.* Mutation-checked: 31 mutants over `recovery.ts`, `snapshot.ts`, `actions.ts` and the executor call sites, each failing at least one test. Not unit-tested, because the suite has no browser: that a `<button>` of unknown type reports `type` "submit", and that the listeners fire. Those rest on the Chromium run in 2.2
- [x] 2.2 Browser check of the lookup
  - *Done, as a run and not a committed test:* the unit suite has no real browser, so the lookup's logic is unit-tested against fake controls and its premises were run in Chromium. Implicit submission there: a disabled first button submits nothing; `type=button` is skipped; an unknown type and an image button are default buttons; a checkbox submits; a `keydown` handler that takes Enter clicks nothing. The lookup on a real page: a `<textarea>`, a formless field and a disabled default name nothing; a `form=` button outside the form is found (36 ms on the notes page); an autocomplete that takes Enter reports not clicked, and one that calls `requestSubmit()` reports submitted; a focused button is named for Enter and Space. That run also caught what no unit test could: a named inner function in the code sent to the page failed there under one compiler, so that code names none
- [x] 3.1 Live: the notes test in split form, 10 runs each on Haiku 4.5 and `gpt-6-luna`, counting notes on file after each run. Before: Luna 8/10, two double submits
  - *Done.* See the results below
- [x] 3.2 Live: the dogfood suite once per model; no refusal that 0.33.0 did not give
  - *Done.* See the results below
- [x] 4.1 `docs/writing-tests.md` and `CHANGELOG.md`
- [x] 4.2 `npm run build`, `npm run typecheck`, `npm test` all pass
- [ ] 4.3 Archive in the same pull request, as its own commit

## Results (3.1, 3.2)

Three sets of runs, one per state of the code. The provider's credit ran out during the third, on Haiku: those runs stopped as incomplete (HTTP 402), which is not a verdict.

| | Haiku 4.5 | `gpt-6-luna` |
| --- | --- | --- |
| Notes test, split form, 0.33.0 | 10/10 | 8/10, two double submits |
| Notes test, before the reviews | 10/10 | 10/10 |
| Notes test, after the first review | 10/10 | 10/10 |
| Notes test, final code | 3/3, 7 incomplete | 10/10 |
| Dogfood suite, after the first review | 10/10, score 100 | 10/10, score 100 |
| Dogfood suite, final code | 2/2, 8 not run | 10/10, score 100 |

Every completed run left one note on file. So Haiku's full set is on the code before the second review, whose changes are to paths these runs do not take: an empty key, the next-page exception, the `submit` listener, two buttons behind one key.

- **The reset rule was exercised by the models.** The repeated click on the emptied form was refused in the model runs of every set (9 times in the second set of 20). None of the refusals failed a step.
- **The Enter rule was not exercised by a model.** In the 53 completed runs a model pressed Enter after its click once (Haiku, a press with no target while nothing had the focus). The page named no button, the press was performed, and it submitted nothing. So the rule's live evidence is a scripted model driving the real page through the executor, each on a fresh count: click, refill, Enter with no key, then Enter on the field (both refused, one note); Enter, refill, click (refused, one note); click twice in a row (refused, one note); Enter twice in a row (refused, one note).
- **Dogfood suite:** one refusal per model, both click, refill, click on the notes test, the #124 shape that 0.33.0 refuses too.
