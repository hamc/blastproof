# Design: refuse-the-same-submit-twice

## D1. A commit is identified by the control it activates

Today's identity is `[action, role, name, value]`, so `click button "Add note"`, `press Enter` on that button and `press Enter` in the form's field are three actions. In the browser they are one: each activates the same button. `StepRecovery` gets, for a press, the control it activates when the executor could find one, and uses that control's click identity for the repeat check and for the record. A press with no such control keeps its own identity.

Recorded both ways. A press that stood for a click is added to `performed` under the click's identity, so the button is refused after Enter. `lastSuccess` holds the click's identity too, so the back-to-back exception treats "Next" clicked and "Next" entered as the same control. It also keeps the press's own identity, for a lookup that finds the button for one of two presses in a row and not the other: that repeat was allowed before and stays allowed. The own identity does not join a press to a different button that was already activated in the step, or one shared key would let Enter in a search box be followed by Enter that submits "Add note" again. A different button not yet activated is a wizard's "Finish" after its "Continue", and is performed.

## D2. Finding the control

Two cases, different in kind.

**A press on a button** (Enter or Space, target role `button`). No lookup: the target is the control. The identity becomes the button's click.

**Enter in a field, or a press with no target.** HTML's implicit submission: Enter in an `<input>` whose form has a default button fires a click on that button. This is a fact about the page, and the accessibility snapshot does not carry it: it has no form membership. So the executor asks the browser, in `actions.ts`:

1. The field is the press's target, resolved by its ref, or `document.activeElement` for a press with no target. Run 1 of #205 was a bare `press [Enter]` after a `fill`, so the focused element has to be covered. A press that names no key is Enter, which is what `performAction` sends; `isCommit` read it as no key at all, so that press was never a commit.
2. In the page, the rule is the one measured in Chromium, not the one first written here:
   - Enter submits from any `<input>` except the button-like, `file`, `color`, `range` and `hidden` types. A checkbox submits. A `<textarea>` does not: Enter there is a new line.
   - The default button is the first submit button the form owns, in tree order. A `<button>` with an unknown `type` is one, and so is `<input type=image>`. A button outside the form with `form=` is owned.
   - When that first button is disabled, Enter submits nothing. The lookup first skipped it and named the next button, which the review caught and a run in Chromium confirmed wrong.
   - When the focused element is itself a button, Enter or Space activates it. This is the only case asked for Space.
3. The button's role and name must be the snapshot's, because that is what a click on it was recorded under. The executor resolves each `button` line of the current snapshot by its ref and asks whether it is that element, stopping at the first yes. A button the snapshot does not show gives no control.

Step 3 costs two round trips per button line until the match (does the ref resolve, is it the button), only on such a press. Measured at 36 ms on the notes page, which has one button. On a page with some hundreds of buttons before the right one, the lookup can run out of its 2 s, and that press is then identified as before: the rule is off for it, silently. Reading an internal ref off the element would be one trip and would depend on a Playwright internal. Matching the button by its text would be the search by name that `act-on-the-element-the-model-read` removed.

The whole lookup is raced against one timer (2 s), because not every Playwright call in it takes a timeout. A lookup that throws or runs out gives no control and the press goes on as today. It never fails a step.

**Rejected: refuse Enter once a repeat was refused in the step.** No browser call, and it covers run 1. It misses click, fill, Enter with no refusal in between, which is the same duplicate. It also refuses a search submitted with Enter later in a step that had a refusal for an unrelated button.

## D2a. Did the press click it

The lookup says which button Enter would click. It does not say Enter clicked it. An autocomplete or a tag input inside a form takes Enter in its own key handler, and nothing is submitted. Recorded as the button's click anyway, "pick Brazil in the country field, fill the name, save" would have its "Save" refused: a new false FAIL on a step that passed (review finding 1).

So the two directions use different evidence:

- **Before the press**, the prediction decides the refusal. Refusing costs a visible failure; performing a second submit is silent.
- **After the press**, the record needs the fact. When the lookup finds the button it leaves two one-shot capture listeners, `click` on the button and `submit` on its form, and the executor asks after the press whether either fired. Only then is the press recorded as that click. `submit` is there for a key handler that takes Enter and calls `requestSubmit()` itself: no click, and a submit all the same (second review). When the page that held the answer is gone, the press navigated, and it is recorded as the click.

The listeners are the only thing this change adds to a page. Each writes to an object of its own, so one left behind by a press that was refused, or by a lookup that finished after its 2 s, changes no later answer. The executor lets go of the object when it asks, and asks for a refused or failed press too.

A key handler that sends the form with `form.submit()` or its own request fires neither event. That press is not recorded as the click, and a click on the button after it is performed.

## D3. A page that came back reset

`followsItselfOnAMovedPage` allows a repeat when the page differs from the one the last success was decided on. A form answered by a redirect to itself differs too: its fields are empty and its list has a new row.

The two snapshots `StepRecovery` already holds tell them apart. The page came back reset when a field line (`textbox`, `searchbox`, `combobox`, `spinbutton`) that had a value on the earlier page is on the later page, same role and name, with no value in any of its occurrences. Then the exception does not hold and the repeat is refused.

| Shape | Field before | Field after | Repeat |
| --- | --- | --- | --- |
| Tour "Next" | none | none | performed |
| Wizard, next page | "Ana" | not on the page | performed |
| "Load more" with a search box | "invoice" | "invoice" | performed |
| "+" on a quantity | "1" | "2" | performed |
| Form answered by a redirect to itself | "Check the invoice" | empty | refused |

The value is in the snapshot of the page the click was decided on, so it does not matter that the `fill` happened in an earlier step, as it did in #205's run 2.

Known wrong refusal: a wizard whose next page has a field of the same name, filled on the first page and left empty on the second, with "Next" pressed twice in a row. It fails visibly on the refusal. The other direction is a silent second submit.

A field with no name decides nothing: every unnamed field would compare equal to every other. And only a field's own lines are read for its value, so text inside a combobox's open list is not taken for one.

## D4. Wording

The repeated-click refusal was measured (#124, refs D5) and stays word for word, including for the reset case. A press refused as a click needs one more fact, or the model reads "this press already succeeded" as false, the failure refs D5 measured. So it says that pressing Enter here activates button "Add note", and that the click on it already succeeded in this step. The rest of the sentence is the existing one. If the notes runs show a model insisting after it, the wording is measured again before merging.

## D5. What is still not caught, and what is refused wrongly

Not caught:

- Enter in a field of a script-driven form with no `<form>`, or a form with no submit button.
- Enter taken by a key handler that sends the form with `form.submit()` or its own request, then a click on the button (D2a).
- A form that came back with every one of its fields renamed, then Enter in one of them (D6): "Add a comment" that returns as "Add another comment".
- A form with no text field, checkboxes only, that came back with one, then Enter in it (D6). Requiring the earlier page to have a field would refuse a tour page followed by a page with a field.
- A bare press when the focus is inside a frame.
- Two different buttons with the same effect.
- A form that keeps its values after submit, clicked twice in a row (`repeat-a-click-that-moves-the-page`, D3).

Refused wrongly, each a visible failure with the reason in the report:

- The wizard of D3.
- After a button was clicked, something else was done, and Enter is pressed in a field of the same form that takes the key for itself (save, type a tag, Enter). The prediction of D2a refuses it. Enter directly after the click, on a page that moved, is performed.

`docs/writing-tests.md` says a different route to the same effect is not caught. It keeps saying so, with Enter in a form no longer the example.

## D6. Enter on the next page of a form

A two-page sign-in in one step is: fill the email, Enter, fill the password, Enter. Both presses click "Next". Before this change they were two identities, `press Enter` on two fields, and both ran. Under D1 they are one click with a `fill` in between, the #124 shape, and the second would be refused (review finding 2). The same step written with clicks on "Next" is refused today, so Enter was the form of it that worked.

What tells the two apart is the field. In #124 the form came back, so the field Enter is pressed in was on the page when the button was last pressed. On a next page it was not. `StepRecovery` keeps, per commit, the page it was last decided on, and performs a press of Enter whose field is not among that page's fields. The field is the press's target, or for a press with no target the field the last successful action filled, since a `fill` leaves the focus there. With no named field, or on an earlier page that has an unnamed one, nothing can be told and the press is refused.

A new field is not enough. A form that reveals a "Tags" field after its first submit has a field that was not there, and Enter in it submits the same form again. So the earlier page must also be gone: none of its named fields is on the current page. On a next page the earlier fields were replaced. Only Enter gets this, not Space.

Only a press gets this. A click on "Next" after a `fill` stays refused, as `repeat-a-click-that-moves-the-page` left it: a click names no field to compare.
