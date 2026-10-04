# Proposal: judge-the-outcome-not-the-means

## Why

A step whose outcome already holds fails, because the judge asks whether the step's *action* happened (#121). The step was *"Dismiss the cookie consent dialog by clicking "Me want it!" and verify the consent dialog is gone"*, on a Juice Shop page where the dialog was already gone.

The seven captured inputs, replayed against the current judge at temperature 0, fail along two deterministic paths:

- **The judge wants the action.** On a page with no consent dialog it writes *"the dialog's absence cannot be verified as the result of dismissal rather than never being shown"*. 2 of 4 inputs fail, 0/3 each. Removing "by clicking" changes nothing, and neither does a claim stating the outcome.
- **Another dialog is taken for the one named.** Behind the Welcome modal, "a dialog is still present" is read as the consent dialog. 3 of 3 inputs fail. A fresh load shows the consent dialog does appear beside the modal, so its absence is real.

## What Changes

- The judgment schema SHALL begin with an `outcome` field: the state the step asks for, as a sentence about the page with its action removed. The reason and the verdict are about that sentence.
- The verdict's description SHALL say the step's action is how its outcome is reached, not part of it, and that an absence is shown by the thing being absent.
- The judge's prompt SHALL say an outcome may already hold before the step acts, and a different element present is not the one the step names.

Leaving out any one leaves an input wrong on the first path: without the field 6/12 samples, without the verdict's sentences 6/12, without the prompt paragraph 9/12. All three get 12/12, with no regression across the corpus. The second path stays 0/9 under every wording tried.

Three **FAIL controls**, with snapshots captured from Juice Shop, join the corpus. In them the consent dialog is still shown, or a different dialog was closed, or the Welcome dialog is still open. Both judges get them right (9/9). They keep outcome-judging from passing an outcome that does not hold.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: a step is judged on the state it asks for, not on whether its action was performed

## Impact

- New dependencies: **none**
- Affects `src/llm/schemas.ts`, the judge's prompt in `src/llm/prompts.ts`, their tests, and `evals/judge/cases/issue-121.json`. Nothing reads `outcome`, and reports are unchanged
- `skills/blastproof/references/authoring.md` says that a step's means is not checked

## Non-goals

- **The second path** moves to a new issue, and its three cases are re-marked to it
- **Checking the means.** *"Sign in with SSO"* passes if the user is signed in another way, because the judge sees the page, not how it got there. Where the means matters, the step names what it leaves on the page
- **The executor**, which clicked "Me want it!" in a step about another banner (#120, shape 2)
