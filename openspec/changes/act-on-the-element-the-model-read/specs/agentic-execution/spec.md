## MODIFIED Requirements

### Requirement: Live element resolution
The executor SHALL resolve a target element by the ref the current accessibility snapshot gave it, on every action attempt, and SHALL NOT persist refs or selectors between actions, steps or runs. A ref SHALL resolve to the element it was read from or to nothing: there SHALL be no search by role, name or text, no substring match and no first hit. The configured browser timeout SHALL bound navigation and how long a resolved element is waited on to become actionable, so that a slow application is waited for rather than retried at.

The role and accessible name the model gives SHALL be compared with those the snapshot shows for that ref, the name normalised for case and runs of whitespace, or with the element's inline text where it has no name. A disagreement, or a target with no role, SHALL be refused as one failed attempt, naming what the model said and what the ref is.

A ref that resolves to nothing, because the page changed since the snapshot, SHALL fail the attempt at once with that reason, and the next iteration SHALL read a fresh snapshot.

#### Scenario: Self-healing after UI change
- **WHEN** an action fails because its ref no longer resolves
- **THEN** the executor retries with a fresh snapshot, allowing the LLM to pick an alternative element, up to the configured per-step retry budget (default 3)

#### Scenario: Navigation honours the configured timeout
- **WHEN** a `navigate` action runs against an application configured with a browser timeout
- **THEN** that timeout bounds the navigation, rather than a value fixed in the code

#### Scenario: A slow element is waited for
- **WHEN** the configured browser timeout is 10 seconds and the element a ref resolves to becomes actionable after 4 seconds
- **THEN** the action succeeds without consuming a retry, because waiting is bounded by the configured timeout rather than by a fixed shorter one

#### Scenario: The timeout is a wait, not a retry
- **WHEN** a resolved element never becomes actionable within the configured timeout
- **THEN** the attempt fails and the existing retry budget applies unchanged, so raising the timeout never increases the number of attempts

#### Scenario: An exact name is not lost to a longer one
- **WHEN** a page shows a button named `Add New` before a button named `Add`, and the model targets the ref of `Add`
- **THEN** the button named `Add` is acted on, because no name is searched for

#### Scenario: A name that matches nothing exactly still resolves
- **WHEN** the model's name for a ref differs from the snapshot's only in case or runs of whitespace
- **THEN** the action is performed on that ref, because the name is a check compared under normalisation, and nothing is matched by substring

#### Scenario: Strategy order outranks match precision
- **WHEN** an element could once have been found by role, by label or by text
- **THEN** none of those strategies is consulted, and the ref alone decides the element

#### Scenario: An ambiguous name still resolves in document order
- **WHEN** two visible controls share an accessible name
- **THEN** the one whose ref the model gave is acted on, never the first in document order; resolving in document order was the defect #60 reported

#### Scenario: A target with a role and no name is not the first of its role
- **WHEN** a page shows buttons "Apply promo code" then "Checkout", and the model targets the ref of "Checkout"
- **THEN** "Checkout" is clicked, and a target giving the role `button` with no name is refused

#### Scenario: A shared name resolves to the element the model read
- **WHEN** two visible controls share the accessible name the model targeted, and the model gives the ref of the second
- **THEN** the second is acted on

#### Scenario: A neighbour's ref is refused
- **WHEN** the model gives the ref of "Apply promo code" with the name "Checkout"
- **THEN** nothing is clicked, and the attempt fails naming both

#### Scenario: A stale ref fails fast
- **WHEN** the element a ref was read from has been replaced or navigated away from
- **THEN** the attempt fails within milliseconds saying the page changed since the snapshot, rather than waiting out the browser timeout

### Requirement: A step does not repeat a commit it already performed
Within a step, the executor SHALL NOT perform an action that commits — a `click`, or a `press` of a key that activates a control — whose action, target and unresolved value match one it has already performed successfully in that same step. The attempt SHALL be refused rather than performed, the refusal SHALL be returned to the model as that action's result together with the reason, and it SHALL count as one failed attempt against the existing per-step retry budget.

Two actions match when their action, unresolved value and target are the same, where a target is identified by the role and accessible name the snapshot shows for the ref acted on (its inline text when it has no name), the name compared case-insensitively with runs of whitespace collapsed. The ref itself SHALL NOT identify a target, because an element the application re-renders gets a new ref.

The record of successful actions SHALL be scoped to the step and reset at every step boundary. It SHALL hold the unresolved value, so that a `{{env.*}}` placeholder is compared as written and no substituted secret is retained.

This requirement is deliberately about repetition, not about mutation: the executor cannot tell from a role and an accessible name whether an action writes to the application, and does not attempt to. It applies to the whole step and not only to recovery after a failed judgment, because the duplicate commit does not require a judgment to have failed — the trigger is a page that has lost the evidence of what was done to it.

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

## ADDED Requirements

### Requirement: The record names the element acted on
A result line, the step's record and the reports SHALL describe a targeted action by the role and accessible name the snapshot showed for the ref acted on, not by the words the model used. The names SHALL be taken from the masked snapshot, so no secret enters the record.

#### Scenario: The log names what was clicked
- **WHEN** a click resolves its ref to button "Checkout"
- **THEN** the result line says it clicked button "Checkout"

### Requirement: Only the executor sees refs
The snapshot given to the judge and to the planner SHALL carry no refs. They choose no element, and the judge corpus's stored snapshots have none.

#### Scenario: The judge reads no ids
- **WHEN** a step is judged
- **THEN** the snapshot in the judge's prompt contains no `[ref=` marker
