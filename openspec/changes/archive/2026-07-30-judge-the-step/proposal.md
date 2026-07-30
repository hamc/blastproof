## Why

An independent evaluation of 0.5.0 against Vikunja produced a **wrong PASS**, confirmed against the application's own database (#31). A test that created a project and verified it existed reported `Score: 100` twice, while `GET /api/v1/projects` showed the project was never created either time.

A wrong FAIL is annoying and visible — someone investigates and finds the tool was wrong. A wrong PASS is silent, and it is the only failure mode that makes a merge gate actively harmful: it converts "we have tests" into false assurance.

One root cause produced it, and it also explains two other observed defects: **the judge never sees the step.**

`assertUserPrompt(expectation, snapshot)` is given a claim and a page and asked whether the page satisfies the claim. It has no idea what question the claim is meant to answer. So:

- Asked to verify a project appeared in a list, the model instead asserted *"the 'Show Archived' checkbox is visible"*. That is true, so the judge passed it — and a passing assertion ends the step. The step's real outcome had already failed, correctly, one turn earlier.
- Asked to verify a project appeared in the list, the model paraphrased the expectation and the judge accepted the project's title *typed into an unsubmitted dialog* as satisfying "visible in the projects list".
- Asked to submit a login form, the model asserted *"the Login button is disabled and the password field is invalid, confirming validation errors"* — evaluated standalone that is true, so it passed, on a login that was in fact succeeding (#32).

In every case the claim was true and irrelevant. The judge could not tell, because it was never told what was being asked.

## What Changes

- The judge is given the **step** as the question it must answer, alongside the model's expectation as the claim offered in support. It passes only when the step's outcome holds.
- Because the question is the step rather than whatever the model proposes, a failed expectation cannot be replaced with an easier one on the next turn. The anchor is the test, not the agent.
- The judge is told that a value present in an uncommitted control is not the same as a committed outcome — the distinction that let an unsubmitted dialog satisfy "visible in the list".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agentic-execution`: an assertion is judged against the step it belongs to, not as a standalone claim; a step's outcome cannot be satisfied by a different, easier claim.

## Non-goals

- **Not** removing the model's expectation. It is useful as the claim being offered and as the reasoning shown in reports; it stops being the *question*.
- Not making a failed assertion permanently sticky. That would remove the wrong PASS bluntly, at the cost of legitimate recovery from a genuine transient — which `trustworthy-verdicts` deliberately added and which is working. Anchoring the question achieves the same protection without discarding that.
- Not the duplicated side effects of a failing step (#28) or per-run usage reporting (#27).
- Not changing what the mask redacts.

## Impact

- `src/llm/prompts.ts` — `assertUserPrompt` and `assertSystemPrompt`; the judge's whole notion of what it is deciding.
- `src/llm/brain.ts` — `judge()` takes the step as well as the expectation.
- `src/runner/executor.ts` — both judge calls, including the re-observation added in `trustworthy-verdicts`.
- `src/auth.ts` — the `auth.verify` judgment, where the configured `verify` text is already the question and the step is the login journey.
- No new npm dependency.
