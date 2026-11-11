# Proposal: refuse-the-same-submit-twice

## Why

Within a step, the executor refuses a commit that already succeeded in that step. Measuring #44 on `gpt-6-luna`, on the demo app's notes page, 2 runs in 10 still submitted the form twice, by two routes the guard does not cover (#205). Both exist on 0.32.0 too, so #44's change did not bring them.

**1. Enter after the click.** The model clicked "Add note", the form came back empty, it filled the field again, and the second click was refused. It then pressed Enter, which submits the same form. The list ended with two notes. The guard compares `press Enter` with `click button "Add note"` and sees two different actions.

**2. The same button, twice in a row.** One repeat is let through on purpose: the same control pressed again right after itself, when the page changed (a tour's "Next", "load more"). Here the page changed because the submit worked and the form came back empty. The second click sent an empty form, the page showed "Note is required", and the step failed on a correct application.

The first is a duplicate write on the application under test, which no report shows. The second is a false FAIL.

## What Changes

**A press is the click it stands for.** A commit is identified by the control it activates, not by the gesture:

- Enter or Space on a button is that button's click.
- Enter in a field of a form is the click of that form's default submit button. The executor asks the page which button that is, at the moment of the press. A press with no target asks about the focused element.

The match holds in both directions: Enter is refused after the click, and the click is refused after Enter. The second direction needs the press to have clicked the button, which the executor asks the page afterwards: an autocomplete that takes Enter for itself submits nothing. When the page names no such button, nothing changes for that press.

One press is let through: Enter in a field that was not on the page when the button was last pressed. That is the next page of a form, as in a sign-in that asks for the email and then the password.

**A form that came back empty is not a next page.** The back-to-back exception no longer holds when a field that held a value before the last commit is on the page again, under the same role and name, with no value. A wizard's next page does not have the field. A "load more" list keeps its search box filled. A submitted form has the field, emptied.

The refusal for Enter names the button it stands for. The refusal for a repeated click keeps its measured wording.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: the repeated-commit requirement identifies a press with the click it stands for, and the one allowed repeat excludes a page that came back reset.

## Impact

- `src/runner/recovery.ts`: commit identity, the reset test, the Enter refusal.
- `src/runner/actions.ts`: one lookup of a field's default submit button, by the snapshot's refs, and whether the press clicked it.
- `src/runner/executor.ts`: asks for it before `refusalFor`, and passes it to `record` when the press clicked it.
- `src/runner/snapshot.ts`: the fields a snapshot shows, and whether each holds a value.
- A press that names no key now counts as Enter, the key it already sent. It is refused in a verification step and as a repeat, as a press of Enter is.
- `docs/writing-tests.md`: the paragraph on repeated commits. `CHANGELOG.md`.
- No model call is added, so the dry-run ceiling does not change. The lookup is browser round trips, only on a press of Enter or Space.
- The judge is untouched, so the judge corpus is not replayed.
- Measured on the notes test in its split form, 10 runs each on Haiku 4.5 and `gpt-6-luna`, counting the notes on file after each run, and on the dogfood suite for refusals that were not there before.

## Non-goals

- **A form submitted by script with no `<form>`**, or a form with no submit button. The page names no button to compare with, so Enter there is identified as today.
- **Two different buttons that do the same thing.** Still not caught, and `docs/writing-tests.md` keeps saying so.
- **A form that keeps its values after submit**, clicked twice in a row. `repeat-a-click-that-moves-the-page` recorded it as residual risk (D3), and it stays.
- **Reading the step's wording** to guess how many submits it asks for (#72).
