# Proposal: repeat-a-click-that-moves-the-page

## Why

Within a step, the executor refuses a commit (a click, or Enter/Space) that already succeeded in that step. That guard closed the duplicate-record defect (#28, #124). It also refuses a step whose outcome **needs** the same click several times (#164). On a real app's 8-stop tour, *"click "Next" … until it shows its last step"* had its second click refused and failed 2 runs in 2, on a page that worked. Wizards, carousels, "load more" and a "+" quantity button have the same shape. Today's only workaround is one step per click, which needs the count in advance.

The two known duplicate shapes both do something else between the two commits:

- **#124:** click "Add note", **fill** the field again, click "Add note".
- **#28:** click "Create Issue", **click "New Issue"**, click "Create Issue".

A tour does nothing between its clicks, and the page moves after each one ("1 of 8", "2 of 8").

## What Changes

A repeated commit SHALL be performed when both hold:

1. **It follows itself.** The last action that succeeded in the step is that same commit. Nothing else succeeded in between.
2. **The page moved.** The snapshot before this attempt differs from the snapshot before that last commit. Refs are stripped, so a re-render alone is no change.

Every other repeat is refused as today, with today's message. A commit whose page did not move (a click that did nothing, or a redirect back to an identical form) is still refused. The per-step action cap (15) still bounds the run.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: the repeated-commit requirement gains this one exception.

## Impact

- `src/runner/recovery.ts` (`StepRecovery`) and its tests. The executor already calls `observe` before every decision and `record` after every success, so it does not change.
- No prompt or refusal wording changes. #124's measured refusal stays as it is.
- Verified on the dogfood notes test, #124's reproduction, 5 runs on Haiku 4.5 with no duplicate note, and on the real app's tour written as one "until" step.

## Non-goals

- **Reading the step's wording** ("until", "N times"). It is English only, and #72 chose not to read steps.
- **More than 15 repeats** in a step. That is the existing cap.
- **A form that keeps its values and shows the new record after submit, clicked twice in a row.** The page moved, so the second click is allowed. Neither known reproduction has that shape, and the model would be clicking past the evidence on screen. The design records it as the residual risk.
