# Design: name-what-blocks-the-click

## Context

The executor's error path is uniform and deliberately so: `performAction` throws, `executor.ts` catches, prefixes `error: `, spends one failed attempt, and hands the message back to the model as `lastResult` (`src/runner/executor.ts:414-421`). Self-healing is exactly that loop — a fresh snapshot plus the previous failure, up to the retry budget.

The loop works when the message is about the target. `Element not found: role=button name="Dismiss"` tells the model to pick something else, and it does. An interception failure is the opposite instruction wearing the same clothes: the target was correct, and picking something else is the one move that cannot help. Playwright's own text says so — `element is visible, enabled and stable`, then `<div …> intercepts pointer events` — but it says it inside a forty-line call log that arrives with a `Timeout 30000ms exceeded` headline, and the model reads the headline.

**How badly it reads the headline is probabilistic, and two rounds of retesting are how that was established** (task 4.2). Across seven replicas of the unfixed build against the same block, five recovered unaided — the model guessed `Escape` — and two reproduced the original signature exactly: three retries of the same click under different names, `Escape` never attempted. So the fault is real, it is not rare, and it is not certain. This design is therefore not built on "the model cannot recover". It is built on the model having nothing to recover *from*, which holds in all seven.

## Goals / Non-Goals

**Goals:**
- Make an obstruction distinguishable from a bad target, in the one channel the model reads
- Replace a generic guess that fits one kind of overlay with a diagnosis that fits every kind
- Name the obstructing element, so the model can find it in the snapshot
- State the recovery once, in the prompt, rather than hoping it is inferred from the message each time
- Cost nothing when no overlay is involved

**Non-Goals:** dismissing overlays automatically; a new action verb; touching element resolution (#60); `plan`'s behaviour against an obstructed page.

## Decisions

### D1: The translation is guarded over `performAction` as a whole, not at each locator call

`click`, `fill`, `press`-with-a-target and `select` all go through Playwright's actionability wait and all can be intercepted. Wrapping each of the four is four places to forget the fifth.

So `performAction` becomes a guard around the existing switch, which is renamed and left otherwise untouched. This is the shape AGENTS.md names as the fix for this repository's recurring defect — the secrets mask, the run budget and the repeated-commit refusal are all guarantees written over a scope rather than at the sites inside it — and the cost here is one function boundary.

The translation is conditional on the error text matching, so an error from any other cause passes through byte-identical. Nothing that does not involve an interception can change behaviour.

### D2: The blocker is quoted from Playwright's own words, not re-derived

The call log line is `<div class="cdk-overlay-backdrop cdk-overlay-backdrop-showing"></div> intercepts pointer events`. The alternative — asking the page which element is at the target's coordinates — means a second round trip, at the moment an action has just spent thirty seconds failing, to recompute something the error already carries.

The captured tag is truncated. A framework's overlay class list is long, decorative, and about to be pasted into a prompt; the first eighty characters carry the identity (`div`, `cdk-overlay-backdrop`) and the rest is noise the model pays for.

The tag is markup, and the model is told everywhere else that it may not use CSS selectors. That is why the message names it as *what took the click* and never as something to target: the model's route to the overlay is the accessibility snapshot, where the dialog and its close control appear as roles and names. The tag is evidence, not a handle.

### D3: The message says the target is fine, in those words

The observed failure was three retries against the same element under different names. That is not a model being careless — it is the only reading available when the message says a click timed out. So the message leads with the fact that inverts it: the element was found, it is visible, and nothing about it is wrong.

Then the two exits, in the order a person would try them: the overlay's own control (which is in the snapshot and is what the application intends), then `Escape` (which works when the dialog offers no visible control, and is already reachable as a targetless `press`).

And explicitly: retrying the same target under a different name will not help. Naming the wrong move is worth a sentence when the wrong move is what a real model did three times in a row.

### D4: One prompt rule, not one per action

`agentSystemPrompt()` already carries a rule for the shape of failure it did not previously distinguish — *"If your previous action errored, re-read the fresh snapshot and choose an alternative element"* — which is correct for a missing target and precisely wrong for a blocked one. The new rule sits beside it and names the exception, rather than qualifying the existing rule into something ambiguous.

It also says that overlays stack, because the application that produced this failure had two of them, and a model that dismisses one and finds itself blocked again should recognise the second rather than conclude that dismissing does not work.

### D5: The runner does not dismiss anything itself

Tempting, and wrong. A cookie consent dialog is a legitimate part of some applications' journeys, and one that is under test in others. A runner that clicks overlays away silently reports a verdict about a page the user never described, and does it in the one channel — an automatic action nobody wrote — that no report can show. The model is told what is in its way; choosing to clear it stays an action, recorded like every other.

## Risks / Trade-offs

- **The pattern is coupled to Playwright's call-log wording.** If that string changes, the translation silently stops firing and behaviour reverts to today's. Mitigated by a unit test that pins the message shape as Playwright emits it, so the coupling is visible and fails loudly on upgrade rather than degrading quietly.
- **A model may now dismiss a dialog that was the point of the test.** The step is still the question and the judge still decides it, so a test about a consent dialog that the model clears fails on its own assertion. Preferable to today, where it fails on a timeout that says nothing.
- **Juice Shop mostly passes without this change.** Five replicas of the published build out of seven cleared the same block unaided, so this is not load-bearing for that application. It is load-bearing for the other two, which failed with the signature this change is named after.
- **The rate is not established and the policy is.** 2 failures in 7 against 0 in 6 is Fisher one-sided p = 0.27, and 0 in 6 is consistent with a true rate as high as ~39%. What the same sample says clearly is categorical rather than statistical: 6 of 6 runs with the diagnosis named the obstruction and acted on it — `Escape`, or once the overlay's own control directly — and 0 of 6 blind-retried, which is the behaviour that defined the failure. At n=6 a policy is observable where a rate is not, and the honest claim is the policy.
- **The reported rate is confounded, and the confound is worth naming.** The reporter disclosed that replicas 6 and 7 were launched as six concurrent processes against one provider. Every anomaly in the whole experiment — both unfixed failures, and the fixed arm's one API error — falls in that batch. The failure signature itself is not in doubt, since it matches an observation made without contention, but `2/7` as a number should not be quoted as the fault's frequency.
- **The verification that produced the null result had a flaw worth recording, so it is not repeated.** The reproduction test was a reconstruction of the draft that originally failed, not that draft itself, and its step read `click … to dismiss the cookie message and verify the cookie banner is gone` — wording that plausibly primes the very dismissal being measured. Worse, no failure baseline was established before the A/B, so a positive result on both sides could never have distinguished the two builds. `notes-plan-quality.md` had already reached this conclusion for `plan` ("pass rate is the wrong acceptance criterion") and it was not applied here.
