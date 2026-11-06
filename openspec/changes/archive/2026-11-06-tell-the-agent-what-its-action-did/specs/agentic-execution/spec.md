## MODIFIED Requirements

### Requirement: The model recovers with the step's own history in view
The model SHALL receive, on every iteration of a step, the actions already performed successfully in that step together with their results, and every check of that step that failed after its re-observation together with the judge's reason, in the order they happened, presented as a record of what it has done and not as instructions. After a successful action, the record SHALL say what changed on the page between the snapshot the action was chosen on and the next one, compared as masked text without refs: that nothing changed, or the changed lines when there are four or fewer. The record SHALL be scoped to the current step, and every value in it SHALL pass through the run-wide mask exactly as the snapshot and the last result already do. The judge's record SHALL NOT include the failed checks or the notes.

#### Scenario: An action whose evidence the page no longer shows
- **WHEN** an action succeeds and the page that follows it no longer shows that it happened — a submit followed by a redirect back to the same page with the form reset
- **THEN** the model still sees that the action was performed and succeeded, rather than inferring from the page alone that nothing has happened

#### Scenario: A failed check is in the record
- **WHEN** a check of the step fails on a settled page and the model is asked for the next action
- **THEN** the record lists that check and the judge's reason after the actions that preceded it

#### Scenario: An action that changed nothing
- **WHEN** an action succeeds and the next snapshot has no line the previous one did not have, and lacks none it had
- **THEN** the record's entry for that action says the page did not change at all

#### Scenario: An action that changed a few lines
- **WHEN** an action succeeds and between one and four lines of the snapshot changed
- **THEN** the record's entry for that action lists those lines, and a ref renumbered between the two snapshots is not counted as a change

#### Scenario: An action that changed the page
- **WHEN** an action succeeds and more than four lines of the snapshot changed
- **THEN** the record's entry carries no note

#### Scenario: The judge's record is unchanged
- **WHEN** a check of the step has failed and another is judged
- **THEN** the judge receives only the actions performed successfully and their results, without the failed check and without any note

#### Scenario: The record is masked
- **WHEN** an action carried a value the run has registered as secret, or a line a note lists showed one
- **THEN** the record shows it redacted, on the same boundary as every other prompt input

#### Scenario: The record does not cross steps
- **WHEN** a new step begins
- **THEN** the record is empty
