## Context

`assertUserPrompt(expectation, snapshot)` builds the judge's entire input:

```
Expectation: <whatever the model proposed this turn>

Page accessibility snapshot:
<snapshot>

Does the snapshot satisfy the expectation?
```

The step never appears. The judge is asked whether a claim is true of a page, not whether the thing being tested happened. `brain.judge(expectation, snapshot)` carries the same shape, and `executor.ts` calls it twice — once, and once more on the re-observation added in `trustworthy-verdicts`.

That single omission produced three observed defects:

1. **Wrong PASS by substitution.** A verify step failed correctly; the model then offered *"the 'Show Archived' checkbox is visible"*; the judge, seeing only that claim, passed it; a passing assertion ends the step. Confirmed against Vikunja's database — the project the test claimed to have created did not exist (#31).
2. **Wrong PASS by uncommitted state.** The same step passed in another run because the project title was present *in an unsubmitted dialog's textbox*, which satisfied the model's paraphrase of "visible in the projects list".
3. **Rationalised `ok` after login submit.** *"The Login button is disabled and the Password textbox has an invalid state indicator, confirming that validation errors exist"* — true of a page mid-request, evaluated standalone, and unrelated to the step "submit the login form" (#32).

In all three the claim was true and irrelevant, and the judge had no basis to notice.

## Goals / Non-Goals

**Goals:**
- A judgment decides whether the **step** happened.
- A failed step cannot be closed by a different, easier claim.
- Entering a value is not mistaken for committing it.

**Non-Goals:**
- Removing the model's expectation — it stays as the claim offered and as report content.
- Making a failed assertion permanently sticky (see D3).
- #28 (repeated side effects), #27 (usage reporting), the masking boundary.

## Decisions

**D1 — The step is the question; the expectation is the claim offered in support.**

`judge()` takes both. The prompt asks whether the step's outcome holds, showing the model's expectation as the argument being made for it. This keeps the expectation useful — it is what the model believes establishes the step, and it belongs in reports — while removing its authority to redefine what is being decided.

Rejected: dropping the expectation and judging the step alone. The expectation carries information the step does not: which of several possible readings the model is actually checking, and what it thinks it just did. Discarding it would make failures harder to diagnose and would remove the only record of the model's reasoning at the moment of judgment.

Rejected: keeping the judge as-is and constraining the executor to reuse the first expectation of a step. That anchors the claim rather than the question, so a poor first expectation — of which we have three examples — becomes the standard for the whole step. Anchoring to the step is anchoring to the thing the user actually wrote.

**D2 — A value entered is not a value committed, and the judge must be told so.**

The accessibility tree does not distinguish "this text is in a textbox I just typed into" from "this text is in the list". Both are text present on the page. The judge needs to be told that a step describing an outcome — appears in a list, is saved, is confirmed — is not satisfied by the value existing in an uncommitted control.

This is prompt guidance, and this project holds that prompt wording is hygiene rather than a boundary. That still applies: it will not stop a determined confusion, and it is not a security claim. It is the cheapest available fix for a specific confusion we have observed twice, and the alternative — teaching the executor to distinguish form state from committed state across arbitrary applications — is not something the snapshot supports.

**D3 — Do not make a failed judgment sticky.**

The blunt fix for the wrong PASS is: once an assertion in a step fails, no later assertion may pass it. That removes the defect completely and would have caught all three cases.

Rejected because it also removes the legitimate case `trustworthy-verdicts` was built for — a page that had not settled, where the second look is correct and the first was an artefact. That change is working, verified by an outside evaluation that specifically probed for the old false FAIL and saw the re-observation rescue a legitimate assertion instead. Anchoring the question achieves the same protection: a claim that does not establish the step cannot pass whether it is offered first, second or fifth.

Worth stating plainly because it is the obvious alternative and it is defensible: if anchoring proves insufficient in practice, stickiness is the fallback, and it should be measured rather than assumed.

## Risks / Trade-offs

- **The judge becomes stricter and starts failing steps that used to pass** → this is the intended direction, but a step whose text is vague ("check it worked") now has less to go on. Vague steps were already the weakest input; this makes their weakness visible as a fail rather than invisible as a pass. The README already advises steps that state their outcome.
- **A longer prompt on every judgment** → the judge call is already the smaller of the two prompts; adding one line of step text is negligible next to the snapshot.
- **Anchoring may not be enough** → the model still writes the expectation, and a sufficiently confused one could in principle argue the step holds. Closure requires re-running the case that produced the wrong PASS, not a unit test.
- **`auth.verify` already is the question** → in `auth.ts` the configured `verify` text is the step in all but name. Passing the login journey as the step there should not make the judgment stricter in a way that breaks working auth recipes; check it explicitly.

## Migration Plan

Behavioural, no config or API change. Suites whose steps state their outcomes should be unaffected; suites relying on vague steps may start failing, which is the point.

Closure requires reproducing the wrong PASS first: the Vikunja project-creation test must be made to fail against current code — confirmed against the application's database, not the tool's own report — before the fix is written, and pass after. A unit test that a claim is judged against a step proves the wiring, not the outcome.

## Open Questions

- Should a judgment that cannot be decided from the snapshot fail, or be reported as inconclusive and retried? Today it must choose pass or fail, and #32 suggests the model resolves ambiguity by inventing a rationale for `ok`. An explicit third outcome may be better than forcing a binary, but it changes the action schema and belongs in its own change if so.
