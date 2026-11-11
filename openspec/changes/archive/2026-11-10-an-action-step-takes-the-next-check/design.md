## Context

`authoring.ts` already classifies steps by their English wording: `isVerificationStep` (a step that starts with a check verb only looks, #139) and `hasVerificationClause` (a step that acts and then checks has its `done` judged, #172). A step that does neither closes on the model's `done` alone. That is right for `fill the note field with …`, and it is where #44's shape goes wrong: on a page that resets after a submit, nothing tells the models that the note in the list is the evidence.

The measurements here come from `examples/demo-app` served on a fresh process per run (the notes page keeps its list in memory), Haiku and Luna through OpenRouter, `concurrency: 1`. Five designs were prototyped; the numbers for each are below and under Alternatives.

## Decisions

### D1. Which steps are judged on the next check

A step qualifies when all of these hold:

- it is not a verification step and has no check clause;
- the next step exists, is in the same list (`setup` never borrows from `steps`), and is a verification step.

The judged sentence is the step with trailing whitespace and punctuation removed, then ` and `, then the check with a leading `and`/`then` removed and its first letter lowercased when the second is not upper case: `submit the add-note form and verify the note "Check the invoice" appears in the notes list`. `hasVerificationClause` accepts it, so the step's `done` is judged by the rule from `judge-a-done-that-closes-a-check`.

A step followed by another action does not qualify. `choose HSBC as the account`, followed by more form filling, is the usual shape in the private showcase suite, and its outcome is checked later.

### D2. The acting model never reads the check

**This is the decision the change lives on.** The first version of this design gave the joined sentence to the acting model too. It fixed the notes test (Haiku 10/10) and reopened #139: on `open the shop page` followed by `verify the page says "Mechanical Keyboard added to cart."`, on a page where nothing was added, both models clicked "Add to cart" to make the check true and the step passed, **10 runs in 10**. The next step then looked at the page the agent had produced and passed too. `a-verification-step-only-looks` refuses that click in the check itself; joined into an action step, nothing refused it, and the judge decides the outcome, not the means (#121).

Showing the model the check as context, with an instruction not to act to make it true, was measured too (B below): no click, but Haiku passed the notes test only 2 runs in 5. A model that knows what the test wants is a model that can produce it, and wording does not reliably stop it. So the model reads the written step, as today, and only the judge reads the check.

### D3. Judged before failing

With D2 alone (E below), the notes test still failed often: the model, sure nothing was sent, answered `fail` or ran out of retries before any judgment was asked for. So when a qualifying step is about to fail with a `StepFailure` and at least one of its actions succeeded, the executor settles the page, takes a snapshot and asks the judge once whether the judged sentence holds, with the check as the claim. A pass closes the step; the result line says so. A failing judgment leaves the original failure in place.

Not done when nothing succeeded, since a step that did nothing has nothing to be credited with, and not when the page left the application's origins, since that snapshot must never reach a prompt (`contained-navigation`). A stop of the run propagates as everywhere else; any other error from the judgment leaves the step's failure in place.

It also runs when the step failed because judged `done`s or `assert`s on the joined sentence ran out of retries. Those judged the model's own claim; this one judges the check, which is the claim the prototype measured. A noisy judge gets one more chance to pass the step there, but the check still runs as its own step and must pass on its own. Skipping it in that case was considered and not measured, so it is left as measured.

The dry-run ceiling (`estimateMaxModelCalls`) counts this judgment: `judgeCalls` more for each qualifying step, found by the same `withNextCheck`. On this repository's suite the ceiling goes from 924 to 933 calls.

### D4. What keeps the written step

Everything a person reads (the `step-start` event, the console log, JUnit, HTML, the failing step) and `StepRecovery`'s value source: a value only the check names, like `"Check the invoice"`, is one the page should show, not one to type. The check still runs as its own step, about one call, so the step count and the score keep the shape the author wrote.

### D5. The direction of errors

A qualifying step used to close on `done` alone; its `done` is now judged, which adds a check. The judgment before failing turns a failed step into a pass only when the check the next step makes already holds on the page the step's own actions produced, and that next step still runs. The model is never told the check, so it is not steered to produce it. The one path by which it can learn it is a failed judgment's reason, returned to it like any judge's reason: in 20 prototype runs of the false check, neither model clicked "Add to cart" after reading one.

## Measured on the implementation

- Notes, split form, 10 runs per model: Haiku 10/10, Luna 8/10. Luna's two failures are its own second submit (see the proposal).
- The false check, 5 runs per model: fails 10/10, and "Add to cart" was never clicked.
- `npm run eval:reliability` with `EVAL_SAMPLES=2` on the 14 mutants whose target test has a qualifying step, and the unmodified suite: no false FAIL in 20 tests per model, no false PASS and nothing caught elsewhere in 28 mutant samples on Haiku and 27 on Luna (one sample incomplete, a provider timeout). The three mutants left out target tests with no qualifying step, which run as before. Two samples bound little, so the published rates in `docs/reliability.md` are not updated from this run.

## Alternatives

Measured on the notes test (should pass) and the false check (should fail):

| Design | notes, Haiku | notes, Luna | false check |
| --- | --- | --- | --- |
| 0.32.0 | 0/10 | 6/10 | fails |
| A: model and judge read the joined sentence | 10/10 | 4/4 | **passes 10/10** |
| B: E, plus the check shown to the model with "never act to make it true" | 2/5 | 5/5 | fails 10/10 |
| E: only the judge reads the joined sentence | 4/5 | 3/5 | fails 10/10 |
| E2: E plus the judgment before failing (this design) | 10/10 | 9/10 | fails 10/10 |
| hint only: the check shown to the model, judge unchanged | 2/10 | 10/10 | not measured |

- **The warning from #44.** Rejected in the proposal: it flags passing steps in our own suite and fixes nothing until someone rewrites their tests.
- **Joining across all following checks.** Not measured, and a failure on the third check would surface in the action step, far from where the author wrote it.

## Risks

- **English only**, inherited from the classifiers. A step they miss runs as it does today.
- **A step whose action failed but whose check already held** now passes. That is `judge-the-outcome-not-the-means`'s accepted trade-off applied one step earlier; the check is the same one the next step would pass.
- **Calls.** Haiku spent 14.0 calls per notes run with the prototype against 10.9 on 0.32.0, where it failed. A judgment before failing is one call more, on a step that was going to fail.
- **The reliability benchmark.** Nine steps of the dogfood suite qualify, so `npm run eval:reliability` runs on both reference models before merge, with a new mutant of the false-check shape, `menu-cart-goes-home`: the phone menu's Cart link goes home, and an agent that knew the check could reach the cart by navigating. Seven mutants target a check right after a qualifying step, and their seeded bug can now fail the test one step early, at the action step judged on that check. The benchmark scores that as caught (the `reliability-benchmark` delta); scored as caught elsewhere, a correct verdict would read as a wrong one.
