## MODIFIED Requirements

### Requirement: A step does not repeat a commit it already performed
Within a step, the executor SHALL NOT perform an action that commits — a `click`, or a `press` of a key that activates a control — whose action, target and unresolved value match one it has already performed successfully in that same step. The attempt SHALL be refused rather than performed, the refusal SHALL be returned to the model as that action's result together with the reason, and it SHALL count as one failed attempt against the existing per-step retry budget.

Two actions match when their action, unresolved value and target are the same, where a target is identified by the role and accessible name the snapshot shows for the ref acted on (its inline text when it has no name), the name compared case-insensitively with runs of whitespace collapsed. The ref itself SHALL NOT identify a target, because an element the application re-renders gets a new ref.

A press that activates a control SHALL be identified as the click it stands for, and SHALL match that click in both directions. A press that names no key, or an empty one, is a press of Enter.

- Enter or Space on a button is the click of that button. This includes a press with no target while a button the snapshot shows has the focus.
- Enter in an input that belongs to a form is the click of that form's default submit button, the first submit button the form owns, when that button is enabled and the snapshot shows it. Which button that is SHALL be asked of the page at the moment of the press, for the field the press names or, for a press with no target, the focused element. It SHALL NOT be inferred from roles, names or position in the snapshot.

A press SHALL be refused as a repeat when the click it stands for already succeeded in the step. A press that was performed SHALL be recorded as that click only when it clicked the button or submitted the button's form, which the executor SHALL ask the page after the press: Enter in a field whose own handler takes the key submits nothing, and SHALL NOT make a later click on the button a repeat.

Where the page gives no such button (the field has no form, the form has no submit button or a disabled one, the button is not in the snapshot, or the page could not be asked within a bounded time), the press SHALL be identified by its own action, target and key, as before, and SHALL be performed or refused on that identity alone. Failing to find the button SHALL NOT fail the step.

A press of Enter SHALL NOT be refused as a repeat of a click when the field it is pressed in was not on the page that click was last decided on, and no named field of that page is on the current one: that is the next page of a form, as in a sign-in that asks for the email and then the password. The field is the press's target, or for a press with no target the field the step's last successful action filled. Where the field has no name, or that earlier page shows a field with no name, the press SHALL be refused.

The record of successful actions SHALL be scoped to the step and reset at every step boundary. It SHALL hold the unresolved value, so that a `{{env.*}}` placeholder is compared as written and no substituted secret is retained.

This requirement is deliberately about repetition, not about mutation: the executor cannot tell from a role and an accessible name whether an action writes to the application, and does not attempt to. It applies to the whole step and not only to recovery after a failed judgment, because the duplicate commit does not require a judgment to have failed — the trigger is a page that has lost the evidence of what was done to it.

One repeat SHALL be performed: a commit that follows its own previous success in the step, with no other action succeeding in between, when the snapshot the model decided it on differs, refs aside, from the one that previous success was decided on. A step that pages through a tour or a wizard needs that, and the measured duplicates each performed another action in between to restore the form.

That repeat SHALL NOT be performed when the page came back reset: a field that held a value in the snapshot the previous success was decided on is in the latest snapshot, under the same role and name, with no value. A form that returns emptied is the page a submit leaves behind, not a next page. A field with no name SHALL NOT decide this.

#### Scenario: A commit is not repeated
- **WHEN** the model proposes a `click` identical to one that already succeeded in the same step
- **THEN** the click is not performed, the model is told it was refused and why, and one failed attempt is spent

#### Scenario: A text hint does not disguise a repeat
- **WHEN** a step has clicked button "Add note", and the model proposes the same ref again with different words for it
- **THEN** the second click is refused, because the target is identified by what the snapshot shows, not by what the model wrote

#### Scenario: Text still identifies a target that has nothing else
- **WHEN** a step has clicked an element whose snapshot line has no accessible name and the inline text "Save", and the model proposes an element whose line shows "Save as draft"
- **THEN** the second click is performed, because for such an element its inline text stands in for the name

#### Scenario: A re-rendered control is the same target
- **WHEN** a step has clicked button "Add note", the application re-renders it under a new ref, and the model proposes clicking it again
- **THEN** the second click is refused, because the snapshot shows the same role and name

#### Scenario: A name differing only in case or spacing is the same target
- **WHEN** a step has clicked button "Add note", and the snapshot later shows button "add  note"
- **THEN** a click on it is refused

#### Scenario: A repeat with no failed judgment is still refused
- **WHEN** a step commits, re-fills a field, and proposes the identical commit again, with no assertion between them
- **THEN** the second commit is still refused, because nothing about a failed judgment is required for the duplicate to occur

#### Scenario: Restoring preconditions is still allowed
- **WHEN** the model navigates back to a form, or fills a field again, before proposing the repeated commit
- **THEN** those actions are performed as before, and only the repeated commit is refused

#### Scenario: A key that navigates is not a commit
- **WHEN** a step presses a key that moves focus or dismisses, such as `Tab` or `Escape`, more than once
- **THEN** every press is performed, because only keys that activate a control commit

#### Scenario: A repeat in a later step is unaffected
- **WHEN** a step ends and a subsequent step performs an action identical to one performed earlier in the test
- **THEN** it is performed, because the record is scoped to a single step

#### Scenario: Refusal cannot loop
- **WHEN** the model keeps proposing refused actions
- **THEN** the failed attempts accumulate and the step fails on the existing retry budget

#### Scenario: A control that moves the page may be pressed again
- **WHEN** a step clicks button "Next", the page's tour counter moves from "1 of 8" to "2 of 8", and the model proposes clicking "Next" again with nothing in between
- **THEN** the click is performed

#### Scenario: Something done in between closes the exception
- **WHEN** a step clicks button "Add note", fills the note field again, and proposes clicking "Add note" again, on a page that changed
- **THEN** the click is refused

#### Scenario: A press that did not move the page is still refused
- **WHEN** a step clicks a button and the next snapshot, refs aside, is identical to the one before it
- **THEN** clicking the same button again is refused


#### Scenario: Enter in the form after its button was clicked
- **WHEN** a step has clicked button "Add note", the form comes back empty, the model fills the note field again and proposes pressing Enter in it
- **THEN** the press is refused as a repeat of the click on button "Add note", and the refusal names that button

#### Scenario: Enter with no target, in the focused field
- **WHEN** a step has clicked button "Add note", the note field has the focus, and the model proposes a press of Enter with no target
- **THEN** the press is refused, because the focused field's form has "Add note" as its default submit button

#### Scenario: The button after Enter submitted the form
- **WHEN** a step has pressed Enter in the note field, fills it again, and proposes clicking button "Add note"
- **THEN** the click is refused, because the press was recorded as that button's click

#### Scenario: Enter on the button itself
- **WHEN** a step has clicked button "Add note" and the model proposes pressing Enter or Space on button "Add note"
- **THEN** the press is refused

#### Scenario: Enter in a field of another form
- **WHEN** a step has clicked button "Add note", and the model proposes pressing Enter in a search field whose form's submit button is "Search"
- **THEN** the press is performed

#### Scenario: A field with no form
- **WHEN** a step has clicked a button, and the model proposes pressing Enter in a field that belongs to no form
- **THEN** the press is identified by its own target and performed, as before

#### Scenario: The same button again on a form that came back empty
- **WHEN** a step clicks button "Add note" on a page whose note field holds "Check the invoice", the page comes back with the note field empty, and the model proposes clicking "Add note" again with nothing in between
- **THEN** the click is refused

#### Scenario: A field that keeps its value does not close the exception
- **WHEN** a step clicks button "Load more" on a page whose search field holds "invoice", the list grows, the search field still holds "invoice", and the model proposes clicking "Load more" again with nothing in between
- **THEN** the click is performed

#### Scenario: A press with no key
- **WHEN** a step has clicked button "Add note", refills the field, and the model proposes a press that names no key
- **THEN** it is refused as Enter would be

#### Scenario: Enter that the field took for itself
- **WHEN** a step presses Enter in an autocomplete field inside a form, the field's own handler takes the key and the form's "Save" button is not clicked, and the model then clicks "Save"
- **THEN** the click is performed, because the press did not click the button

#### Scenario: A disabled default button
- **WHEN** the model proposes Enter in a field whose form's first submit button is disabled
- **THEN** the press is identified by its own target, because Enter there submits nothing

#### Scenario: Enter with the focus on a button
- **WHEN** a step has clicked button "Save", the button keeps the focus, and the model proposes a press of Enter or Space with no target
- **THEN** the press is refused as a repeat of the click on "Save"

#### Scenario: Enter on the next page of a form
- **WHEN** a step fills "Email" and presses Enter, which clicks "Next", then on the page that follows fills "Password" and proposes Enter in it, which would click "Next" again
- **THEN** the press is performed, because "Password" was not on the page "Next" was last pressed on

#### Scenario: A field the same form gained
- **WHEN** a step has clicked button "Add note" on a page with a "Note" field, the page comes back with "Note" and a new "Tags" field, and the model proposes Enter in "Tags"
- **THEN** the press is refused, because "Note" is still on the page

#### Scenario: A key handler that submits the form itself
- **WHEN** a step presses Enter in a field whose handler takes the key and asks the form to submit, and the model then refills the field and clicks the form's button
- **THEN** the click is refused, because the press submitted the button's form

#### Scenario: Two buttons behind one key
- **WHEN** a step has clicked "Add note", presses Enter in a search field, which clicks "Search", and then proposes Enter where the page names "Add note"
- **THEN** the press is refused, because the two presses activate different buttons

#### Scenario: A wizard paged with Enter ends on another button
- **WHEN** a step presses Enter, which clicks "Continue", the page moves, and the model proposes Enter again where the page names "Finish", not yet activated in the step
- **THEN** the press is performed

#### Scenario: The button is found one time and not the next
- **WHEN** a step presses Enter twice in a row on a page that moved, and the page names a button for only one of the two presses
- **THEN** the second press is performed, as it was before
