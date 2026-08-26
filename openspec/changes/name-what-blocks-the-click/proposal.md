# Proposal: name-what-blocks-the-click

## Why

An evaluation against OWASP Juice Shop reported **zero passing tests in two full runs**, on the application's first screen. The shape is real and reproducible: the page opens with a cookie banner and a welcome dialog stacked on top of each other, and the dialog's backdrop takes every pointer event aimed at the banner underneath.

**That headline number did not survive retesting, and this proposal is written after it did not** (task 4.2). Against the published 0.15.0 — no fix, nothing changed — the same block recovered on its own in four replicas out of four: given only Playwright's raw call log, the model guessed `Escape`, and the step passed. The reporter also later disclosed that the original evaluation had itself reached a green suite in the same session and never updated the document. So there is **no failure baseline**, the `0 of 2` describes a sample rather than a behaviour, and no claim here rests on it.

What survives is narrower and is what this change is actually for. The recovery above is a generic guess that happens to fit one kind of obstruction, made in the absence of any diagnosis. This change replaces the guess with a diagnosis. The measured difference is in *how* the model gets there, not in whether it does — see task 4.2 for what was and was not established.

Playwright reports this precisely. `locator.click()` waits, finds the element `visible, enabled and stable`, and then writes into its call log `<div class="cdk-overlay-backdrop …> intercepts pointer events` before timing out. That message reaches the model as a raw multi-line Playwright timeout through `lastResult`, and the model does with it what the reporter observed: it treats the *target* as the problem and retries the same element under three different accessible names, spending the whole retry budget without ever touching the overlay.

The evaluation concluded that this is "a structural limit of an accessibility-tree design". It is not — that much the retest confirms from the other side, since a limit the model routinely works around unaided is not a limit — and the same report already contained the disproof: `plan --route /login` generated a draft describing the home page, because the snapshot it captured held **only the two overlays** — Angular CDK marks everything behind a modal `aria-hidden`, so the tree reported the obstruction with complete fidelity. The tree told the truth both times. Nothing in the prompt or in the result string told the model what the truth meant.

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
- **No measured change in pass rate**, and none is claimed. Cost is unchanged too: one failed attempt per blocked step, ~10 model calls, on both sides of the A/B

## Why keep it, given the null result

Two arguments, both **untested**, and named as such rather than presented as findings:

- **`Escape` is not a general solution to obstruction.** It closes a CDK modal dialog left at its default `disableClose: false`. It does nothing against a non-modal overlay — a fixed cookie bar, a chat widget, a sticky header — nor against a dialog that declines to close, nor a full-page loading shade. In every one of those the lucky heuristic has nowhere to go and there is still no diagnosis. Naming the blocker is what covers them.
- **The luck is model-dependent.** The model that guessed `Escape` was `claude-haiku-4.5`. The same evaluation's `deepseek-v4-flash-0731` run, on the same block, clicked an unrelated element instead. The value of an explicit diagnosis rises exactly as the model weakens, which is the population the documentation is least able to speak for.

The experiment that would settle this is an overlay `Escape` cannot close, built as a fixture in `examples/demo-app`, which gives the failure baseline this verification never had. Until that exists, this change is justified as a correctness improvement to what the model is told, not as a measured improvement to what it achieves.

## Non-goals

- **No dismissing an overlay on the model's behalf.** The runner does not decide that a dialog is disposable — a consent dialog is part of some applications' journeys, and clicking it away silently would be the tool making a product decision inside a test it is meant to be reporting on
- No new action verb. `press Escape` and clicking a close control are both already in the vocabulary; #22 is where a wider vocabulary belongs
- No change to element resolution. The substring match and `.first()` fallback are #60's subject and carry a compatibility risk this change deliberately does not take on
- No change to `plan`, which meets the same overlays one screen earlier. That is the same root cause seen from the authoring end and needs its own decision about whether a draft may be generated from an obstructed page
