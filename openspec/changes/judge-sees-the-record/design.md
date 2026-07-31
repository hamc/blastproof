## Context

`judge(step, expectation, snapshot)` decides whether the step's outcome holds. Its entire view of the world is the step text and a snapshot whose first line is `url: …`.

For `navigate to /away` against a server that answers `302 http://localhost:4194/`, that view is:

```
Step under test: navigate to /away
Page accessibility snapshot:
url: http://localhost:4194/
- heading "Partner portal"
```

There is no honest way to decide that from those inputs. The judge concluded *"the navigation did not occur"*, which is the reasonable reading of what it was shown and the wrong answer about what happened.

Measured, 0.9.0, `anthropic/claude-haiku-4.5`, identical destination content in both arms:

| `/away` redirects to | runs | outcome |
|---|---|---|
| `/destination` (same host) | 3 | all pass |
| `http://localhost:4194/` (another host) | 3 | all fail |

The same-origin arm passing is not the judge being correct; it is the judge tolerating a smaller discrepancy. Both arms are the same missing fact.

## Goals / Non-Goals

**Goals:**
- The judge knows what was done in the step, not only what the page looks like now.
- A navigation says where it landed.
- Close the family, not this instance.

**Non-Goals:**
- Teaching the judge that redirects are normal. That is the instance.
- Loosening what counts as a step's outcome.

## Decisions

### D1 — `navigate` reports where it landed

**Decision.** After `page.goto`, compare `page.url()` with the requested URL. When they differ, the result becomes `ok: navigated to <requested>, which redirected to <landing>` instead of `ok: navigated to <requested>`.

**Why.** The executor has both facts and currently discards one. The result string is what reaches the model on the next turn and what the step record stores, so this is the cheapest place to stop throwing it away. It is also true independently of this defect: a run log that says a navigation went somewhere it did not is misleading to whoever reads it afterwards.

**Why comparison and not "did we redirect".** Playwright does not report a redirect chain here, and it does not need to: what matters is whether the browser ended up somewhere other than asked, which is one string comparison.

### D2 — The judge receives the step's record

**Decision.** `judge()` takes the actions already performed successfully in the current step, with their results — the same record `StepRecovery` builds for the planner. The judge prompt presents it as *what was done*, explicitly not as evidence that the step's outcome holds.

**Why this rather than a clause about redirects.** DEF-005 records that this project reaches for a prompt clause too readily, and names this exact lever as the thing to try when a third defect of this family appears. This is that third one — after the form reset that survived a submit (#28) and the control that disappears when an action succeeds (0.6.0's third clause). Each was answered by describing one more shape to the judge. A fourth would be a fourth description; the record is the missing input all three were working around.

With D1's landing URL in it, the record for the failing case reads:

```
1. navigate [/away] -> ok: navigated to http://localhost:4195/away,
   which redirected to http://localhost:4194/
```

which answers the question the judge could not.

**The main risk, stated plainly.** The record must not become a licence to pass. "I clicked Add note and it returned ok" is not evidence that a note appears in the list, and a judge that treats the record as proof of outcome would undo `judge-the-step` — trading a wrong FAIL for the wrong PASS that change was written to close. The prompt therefore says what the record is *for*: knowing what has been attempted and where it led, while the snapshot remains the only evidence of what is now true. This is the one thing to check hardest in review and in the real-model runs.

**Second risk, previously realised.** An action transcript was put into a prompt once before, in `src/auth.ts`, and the model read it as instructions rather than history — working logins broke. That was this same shape of input in the judge's neighbour. The wording must be unambiguous and the login journey must be run against a real model before this ships. The unit suite did not catch it last time and will not catch it now.

### D3 — Scope stays the step

**Decision.** The record passed is the current step's, cleared at every step boundary, exactly as the planner's is.

**Why.** A judgment decides one step. Earlier steps are the test's own narrative and belong to the ordered list of steps, not to this decision; carrying them would grow every judge prompt for no verdict it changes.

## Risks / Trade-offs

- **The record could be read as evidence of outcome** — the wrong-PASS risk above. Mitigated by wording and by verification, not by structure; there is no way to hand over the fact without also handing over the temptation.
- **Every judgment's prompt grows.** Bounded by the per-step action ceiling and only successful actions are recorded, so it is small next to a 200-line snapshot. A judgment that used to see nothing now sees a handful of lines.
- **The same-origin case already passes**, so part of this change fixes something that is not currently failing. That is the point: it passes by tolerance, and tolerance is not a property to depend on.

## Migration Plan

None. No configuration, no test-file format, no CLI surface. A navigation that does not redirect produces the identical result string it does today.

## Open Questions

None blocking. Noted: `judge()`'s signature grows a fourth parameter, and the auth path passes a record of the login journey rather than of a test step. That is the correct record for that judgment, but it is the place where the transcript-as-instructions failure happened before, so it is the one to watch.
