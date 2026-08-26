# Proposal: name-what-blocks-the-click

## Why

An evaluation against OWASP Juice Shop produced **zero passing tests in two full runs**, on the application's first screen, with two different models. The cause is one shape: the page opens with a cookie banner and a welcome dialog stacked on top of each other, and the dialog's backdrop takes every pointer event aimed at the banner underneath.

Playwright reports this precisely. `locator.click()` waits, finds the element `visible, enabled and stable`, and then writes into its call log `<div class="cdk-overlay-backdrop …> intercepts pointer events` before timing out. That message reaches the model as a raw multi-line Playwright timeout through `lastResult`, and the model does with it what the reporter observed: it treats the *target* as the problem and retries the same element under three different accessible names, spending the whole retry budget without ever touching the overlay.

The evaluation concluded that this is "a structural limit of an accessibility-tree design". It is not, and the same report contains the disproof: `plan --route /login` generated a draft describing the home page, because the snapshot it captured held **only the two overlays** — Angular CDK marks everything behind a modal `aria-hidden`, so the tree reported the obstruction with complete fidelity. The tree told the truth both times. Nothing in the prompt or in the result string told the model what the truth meant.

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
- **Additive**: no action is refused that was performed before, and no message a passing suite depends on changes. A run that previously exhausted its retries against an overlay now has a chance to recover; a run that never hit one is untouched

## Non-goals

- **No dismissing an overlay on the model's behalf.** The runner does not decide that a dialog is disposable — a consent dialog is part of some applications' journeys, and clicking it away silently would be the tool making a product decision inside a test it is meant to be reporting on
- No new action verb. `press Escape` and clicking a close control are both already in the vocabulary; #22 is where a wider vocabulary belongs
- No change to element resolution. The substring match and `.first()` fallback are #60's subject and carry a compatibility risk this change deliberately does not take on
- No change to `plan`, which meets the same overlays one screen earlier. That is the same root cause seen from the authoring end and needs its own decision about whether a draft may be generated from an obstructed page
