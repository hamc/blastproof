# Proposal: name-what-blocks-the-click

## Why

An evaluation against OWASP Juice Shop reported **zero passing tests in two full runs**, on the application's first screen. The shape is real and reproducible: the page opens with a cookie banner and a welcome dialog stacked on top of each other, and the dialog's backdrop takes every pointer event aimed at the banner underneath.

**The headline number is a rate, not a behaviour, and this proposal is written after two rounds of retesting said so** (task 4.2). Against the published 0.15.0 — no fix, nothing changed — the same block was cleared unaided most of the time: the model guessed `Escape` from Playwright's raw call log and moved on. Across seven replicas it failed twice, and those two failures carried the original signature exactly — three blind retries of the same click under different names, `Escape` never once attempted. So the failure mode is real and confirmed; `0 of 2` was a small sample of a **probabilistic** fault, not a deterministic one, and nothing here rests on it being deterministic.

What this change is for is the part that is not probabilistic. Clearing the block unaided is a generic guess that happens to fit one kind of obstruction, made with no diagnosis available. This change supplies the diagnosis. Across six replicas with it, the model named the obstruction and acted on it every single time and never once blind-retried — which is a change in the model's policy, observable at this sample size, where the change in outcome rate is not (Fisher one-sided p = 0.27). See task 4.2 for the separation of what was established from what was not.

Playwright reports this precisely. `locator.click()` waits, finds the element `visible, enabled and stable`, and then writes into its call log `<div class="cdk-overlay-backdrop …> intercepts pointer events` before timing out. That message reaches the model as a raw multi-line Playwright timeout through `lastResult`, and the model does with it what the reporter observed: it treats the *target* as the problem and retries the same element under three different accessible names, spending the whole retry budget without ever touching the overlay.

The evaluation concluded that this is "a structural limit of an accessibility-tree design". It is not — a limit the model works around unaided in five runs out of seven is not a limit — and the same report already contained the disproof: `plan --route /login` generated a draft describing the home page, because the snapshot it captured held **only the two overlays** — Angular CDK marks everything behind a modal `aria-hidden`, so the tree reported the obstruction with complete fidelity. The tree told the truth both times. Nothing in the prompt or in the result string told the model what the truth meant.

Every primitive the recovery needs already exists: the overlay and its own dismiss control are in the snapshot, and a `press` with no target reaches `page.keyboard` (`src/runner/actions.ts:243`), with `Escape` deliberately outside `COMMIT_KEYS` so it is never refused as a repeat. What is missing is that the failure is unreadable and the rule is unstated.

## What Changes

**The result names the blocker.** A failed action whose Playwright error carries an interception line is translated into a short `ActionError` that says the target was found and is fine, names the element that took the pointer event, and gives the two exits — dismiss the overlay through its own control, or press `Escape`. The raw call log stops being what the model reads.

**The prompt states the rule.** `agentSystemPrompt()` gains one rule: a blocked action means something is on top of the target, not that the target is wrong; find what is covering it in the snapshot and dismiss that first; retrying the same target under another name cannot help.

The translation is guarded over the whole of `performAction` rather than at the four call sites that touch a locator — `fill`, `press` and `select` are subject to the same actionability wait as `click`, and a guarantee written at a call site instead of over its scope is this repository's named recurring defect.

## Capabilities

### Modified Capabilities

- `agentic-execution`: an action blocked by an element on top of its target is reported as an obstruction naming the blocker, and the model is instructed to clear the obstruction rather than re-target

## Impact

- New dependencies: **none**
- Affects: `src/runner/actions.ts`, `src/llm/prompts.ts`, `tests/`
- **Additive**: no action is refused that was performed before, and no message a passing suite depends on changes. A run that never meets an overlay is untouched
- **The change in pass rate is not statistically established**, and is not claimed: 2 failures in 7 without, 0 in 6 with, which is Fisher one-sided p = 0.27. What is established at this sample size is the policy — 6 of 6 named the obstruction and acted on it, 0 of 6 blind-retried. Cost is unchanged: one failed attempt per blocked step, ~10 model calls, on both sides

## Why keep it, given a result that is directional rather than significant

The retest confirms the fault exists and that this change addresses its signature. It does not carry the sample size to prove a rate. Two further arguments stand behind it — the first now has a fixture and no live run, the second neither:

- **`Escape` is not a general solution to obstruction.** It closes a CDK modal dialog left at its default `disableClose: false`. It does nothing against a non-modal overlay — a fixed cookie bar, a chat widget, a sticky header — nor against a dialog that declines to close, nor a full-page loading shade. In every one of those the lucky heuristic has nowhere to go and there is still no diagnosis. Naming the blocker is what covers them.
- **The luck is model-dependent.** The model that guessed `Escape` was `claude-haiku-4.5`. The same evaluation's `deepseek-v4-flash-0731` run, on the same block, clicked an unrelated element instead. The value of an explicit diagnosis rises exactly as the model weakens, which is the population the documentation is least able to speak for.

The experiment that would settle this now exists: `examples/demo-app/consent.html` (task 5.1), a consent wall with no `keydown` handler at all. It matters for arithmetic as much as for coverage. Against Juice Shop the unfixed failure rate is around a quarter, so separating the arms at p < 0.05 needs roughly fifteen replicas each; against a wall that never yields to `Escape` the unfixed arm should fail every time, and four or five replicas each reach p = 0.014 or better. The fixture is what makes this decidable at a sample size anyone will actually run.

## Non-goals

- **No dismissing an overlay on the model's behalf.** The runner does not decide that a dialog is disposable — a consent dialog is part of some applications' journeys, and clicking it away silently would be the tool making a product decision inside a test it is meant to be reporting on
- No new action verb. `press Escape` and clicking a close control are both already in the vocabulary; #22 is where a wider vocabulary belongs
- No change to element resolution. The substring match and `.first()` fallback are #60's subject and carry a compatibility risk this change deliberately does not take on
- No change to `plan`, which meets the same overlays one screen earlier. That is the same root cause seen from the authoring end and needs its own decision about whether a draft may be generated from an obstructed page
