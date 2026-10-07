# Proposal: judge-the-place-the-step-names

## Why

The reliability benchmark found a false PASS on the default model (#147). The confirmation shows order `#BP-1002`; another paragraph mentions `#BP-1001` as a previous order. The step `Verify the order number "#BP-1001" is displayed in the confirmation message` passed: 2 of 5 samples on `claude-haiku-4.5` in the first benchmark run, 3 of 13 overall, and 1 of 1 on `gpt-4o-mini`. `gpt-6-luna` judged it right every time.

A proxy captured a wrong PASS's judge input. There, the executor's claim did the moving: *"'#BP-1001' should be visible in the confirmation message, **specifically in the paragraph stating 'Your previous order, #BP-1001, has shipped.'**"* With a neutral claim, the judge got the step right in 34 of 34 captured judgments. The judge already treats a claim as an argument, not as the question. What it lacked was the idea that **where** a step puts a value is part of the outcome, so a claim that renames a place gets the value counted where the step never put it.

This is #87's and #120's shape (right token, wrong place) in plain text, which their fixes on masked secrets do not cover.

## What Changes

- The judge's prompt SHALL say that a place the step names (in the confirmation, in the list, for this order) is part of the outcome. The judge identifies that element from the snapshot, and the same value elsewhere does not satisfy the step, even when the claim calls the other place by the step's words.
- The `pass` description in the judgment schema SHALL say that a value found only somewhere else on the page is false.
- The judge corpus SHALL gain `issue-147.json`: two captured relocating claims, one captured neutral claim (FAIL), and a reconstructed control where the value is in the confirmation and another order is mentioned elsewhere (PASS).

Neither piece suffices alone. With the paragraph only, the corpus case was fixed, but a live sample still passed with a reason that said the opposite: *"…appears in a paragraph about a previous order… not as the current order number being confirmed"*, then `pass: true`. A second sentence in `pass` ("a reason that places the value elsewhere is a reason for false") ended those, and it broke two #121 cases on Haiku, which read it as "a reason that contradicts the claim is false". It is not in this change.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: a value counts only in the place the step names

## Impact

- `src/llm/prompts.ts` (one paragraph), `src/llm/schemas.ts` (one sentence), the corpus file. No new dependencies
- Verdicts change in one direction: a step naming a place can now fail on a value shown elsewhere

## Non-goals

- **Withholding the claim from the judge.** The claim misled the judge here. But judge-the-step deliberately kept the claim as an argument, and removing it changes every verdict, which needs its own evidence
- **#129**, the other Haiku-only verdict case, which this does not touch
