# Spec delta: agentic-execution (identify-a-commit-by-what-resolves-it)

## MODIFIED Requirements

### Requirement: A step does not repeat a commit it already performed
Within a step, the executor SHALL NOT perform an action that commits — a `click`, or a `press` of a key that activates a control — whose action, target and unresolved value match one it has already performed successfully in that same step. The attempt SHALL be refused rather than performed, the refusal SHALL be returned to the model as that action's result together with the reason, and it SHALL count as one failed attempt against the existing per-step retry budget.

Two actions match when their action, unresolved value and target are the same, where a target is identified by what resolution uses to choose the element: its role, its accessible name compared case-insensitively with runs of whitespace collapsed, and its visible text **only when it has neither a role nor a name**. A hint that resolution never reads SHALL NOT make two actions on the same element different.

The record of successful actions SHALL be scoped to the step and reset at every step boundary. It SHALL hold the unresolved value, so that a `{{env.*}}` placeholder is compared as written and no substituted secret is retained.

This requirement is deliberately about repetition, not about mutation: the executor cannot tell from a role and an accessible name whether an action writes to the application, and does not attempt to. It applies to the whole step and not only to recovery after a failed judgment, because the duplicate commit does not require a judgment to have failed — the trigger is a page that has lost the evidence of what was done to it.

#### Scenario: A commit is not repeated
- **WHEN** the model proposes a `click` identical to one that already succeeded in the same step
- **THEN** the click is not performed, the model is told it was refused and why, and one failed attempt is spent

#### Scenario: A text hint does not disguise a repeat
- **WHEN** a step has clicked button "Add note", and the model proposes clicking button "Add note" with the text "Add note"
- **THEN** the second click is refused, because the role and name resolve the same element and the text is never read

#### Scenario: A name differing only in case or spacing is the same target
- **WHEN** a step has clicked button "Add note", and the model proposes clicking button "add  note"
- **THEN** the second click is refused

#### Scenario: Text still identifies a target that has nothing else
- **WHEN** a step has clicked the element with text "Save", and the model proposes clicking the element with text "Save as draft", neither with a role or a name
- **THEN** the second click is performed, because for such targets the text is what resolution uses

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
