# Design: judge-the-place-the-step-names

## Context

`evals/reliability` mutant `order-number-elsewhere` serves the checkout page with `#BP-1002` in the confirmation and `#BP-1001` in a paragraph about a previous order. The checkout test's step 4 asks for `#BP-1001` *in the confirmation message*. A relaying proxy recorded every judge request and response for 8 samples on Haiku. One step-4 judgment passed, and its input is `147-claim-relocates-the-value-run1`. In it the claim, not the page, put `#BP-1001` "in the confirmation message, specifically in the paragraph stating 'Your previous order…'". The judge's reason repeated the claim's framing. The other 34 step-4 judgments had claims that left the value where it was, and every one was false.

## D1. A place the step names is part of the outcome (prompt)

One paragraph in `assertSystemPrompt`, placed after the paragraph on claims, because it is a case of the same rule. A claim true of something else on the page does not establish the step. It names the shape (in the confirmation message, in the list, in the cart, for this order), tells the judge to identify the named element from the snapshot itself, and says that the claim using the step's words for another place changes nothing.

Alone, it fixed the captured case (Haiku 0/3 → 3/3, no corpus regression), and live samples still passed 1 in 10. That sample's reason was right and its verdict was not: *"'#BP-1001' is present in the confirmation message, but it appears in a paragraph about a previous order… not as the current order number being confirmed, which is '#BP-1002'"*, `pass: true`.

## D2. The decision says it too (schema)

One sentence in `pass`'s description: *"Where the step says the outcome appears (in the confirmation, in the list, for this order) is part of it: a value found only somewhere else on the page is false."* The `pass` description is read at the moment of deciding. #121 needed it for the same reason: prose in the prompt moved the reason, and only prose in the schema moved the verdict.

## D3. The sentence that was removed

A second sentence, *"A reason that places the value elsewhere is a reason for false"*, aimed at D1's contradiction directly. With it, live samples were 0/10, and two `#121-already-dismissed` cases went 3/3 → 0/3 on Haiku. The reason given was *"the model's expectation requires the dialog to be present before dismissal"*. The judge read "elsewhere" as "a reason that disagrees with the claim". Without it, the corpus has no regression and live samples are still 0/10.

D2 alone leaves the captured case wrong on Haiku (0/3), so D1 and D2 are both needed: the paragraph for the case, and the sentence for the decision.

D2 also moved one of #129's cases. `121-already-dismissed-run1-2` was right on both models in two replays with D2, and wrong in every replay without it. That is consistent with D2 making the judge decide on the element the step names, here the dialog it says is gone. Its `knownFailing` marker is removed. #129's other two cases are unchanged.

## D4. Rejected: withhold the claim from the judge

The claim was the vector, and a judge deciding from the step and the page alone could not be led this way. But judge-the-step kept the claim deliberately, as the argument offered for the step, reported next to the verdict. Withholding it would change every verdict the corpus holds, not just this shape. If a later incident shows claims misleading the judge again, that is the change to propose, with the benchmark to measure it.

## D5. Corpus

`issue-147.json`:
- two captured relocating claims (FAIL), one from before the fix and one from after;
- one captured neutral claim on the same page (FAIL), so the fix cannot be bought by weakening the plain case;
- a control rebuilt from the same snapshot, with `#BP-1001` in the confirmation and `#BP-0998` as the previous order (PASS), so the fix cannot be bought by failing every page that mentions a second order.
