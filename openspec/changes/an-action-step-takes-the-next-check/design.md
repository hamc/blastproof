## Context

`authoring.ts` already classifies steps by their English wording: `isVerificationStep` (a step that starts with a check verb only looks, #139) and `hasVerificationClause` (a step that acts and then checks has its `done` judged, #172). A step that does neither closes on the model's `done` alone. That is right for `fill the note field with …`, and it is where #44's shape goes wrong: the model has no outcome to aim for, so on a page that resets after a submit it cannot tell success from nothing.

The measurements in the proposal come from `examples/demo-app` served on a fresh process per run (the notes page keeps its list in memory), Haiku and Luna through OpenRouter, `concurrency: 1`.

## Decisions

### D1. Which steps are joined

A step is joined when all of these hold:

- it is not a verification step and has no check clause;
- the next step exists, is in the same list (`setup` never joins into `steps`), and is a verification step.

The sentence is the step with any trailing whitespace and period removed, then ` and `, then the next step with its first letter lowercased: `submit the add-note form and verify the note "Check the invoice" appears in the notes list`. `hasVerificationClause` accepts that sentence, so the `done` rule from `judge-a-done-that-closes-a-check` applies unchanged.

A step followed by another action is not joined. `choose HSBC as the account`, followed by more form filling, is the usual shape in the private showcase suite, and its outcome is checked later, by a step that is not next to it.

### D2. Who reads the joined sentence

The acting model and the judge read it, because they are the two that need to know what the action is for. Everything a person reads keeps the written step: the `step-start` event, the console log, JUnit and HTML. A report showing a step the author never wrote would be harder to trust than the failure it fixes.

### D3. The value source stays the written step

`StepRecovery` takes the step's text as the first place a typed value may come from (`refuse-an-invented-value`). It keeps the written step. A quoted value in the check, like `"Check the invoice"`, is something the page should show, not something to type. The prototype passed the joined sentence there too, and after its submit Haiku retyped exactly that value into the emptied form; the repeated click was refused, so nothing was written twice, but it is the wrong move made legal by the join. With the written step that value is typeable only where it already is today: shown on the page, or read on an earlier one. Task 2.1 measures the change as designed, not the prototype.

### D4. The next step still runs

The check runs again as its own step, against the same page. It costs one judgment, about 1 call, and keeps the step count, the per-step results and the score as the author wrote them. Skipping it would make a pass in the joined step stand for two steps, which the report has no way to show.

### D5. The direction of errors

A joined step is judged where it used to close on `done` alone, so the change adds a check and never removes one: it cannot create a false PASS. A step joined wrongly is judged one step early on a check that is about to run anyway, against the page its own action produced, which is the page the check would have seen.

## Alternatives

- **The warning from #44.** Rejected for the reasons in the proposal: the narrowest heuristic flags passing steps in our own suite, and it fixes nothing until someone rewrites their tests.
- **Showing the next step to the model as context.** Prototyped: `The step after this one will check: …` in the user prompt. Luna went from 6/10 to 10/10, Haiku only from 0/10 to 2/10: told what to aim for, Haiku still asserted "the form was submitted", and the judge, reading the written step, failed it. The judge has to read the outcome too, which is what the join does.
- **Joining across all following checks.** Not measured, and a failure on the third check would surface in the action step, far from where the author wrote it.

## Risks

- **English only**, inherited from the classifiers. A step they miss runs as it does today.
- **Calls.** Haiku spent 14.2 calls per notes run with the prototype against 10.9 for the split form on 0.32.0, which failed. `--dry-run`'s ceiling counts iterations per step and is unaffected.
- **The reliability benchmark.** The dogfood login and support tests become joined, so `npm run eval:reliability` runs again on both reference models before merge, to show the mutants that target them still fail.
