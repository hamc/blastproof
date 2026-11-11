## ADDED Requirements

### Requirement: An action step followed by a check is judged on that check

When a step is not a verification step, carries no verification clause, and the next step in the same list (`setup` or `steps`) is a verification step, the executor SHALL judge the step on the sentence `<step> and <next step>`: every judgment made in the step SHALL read that sentence, and a `done` on the step SHALL be judged as for a step carrying a verification clause.

The acting model SHALL read the step as written and SHALL NOT be shown the next step.

When such a step is about to fail after at least one of its actions succeeded, on a page within the allowed origins, the executor SHALL judge the joined sentence once on the current page, with the next step as the claim. A passing judgment SHALL close the step as passed.

The step SHALL keep its written text everywhere a person reads it: run events, the console log and the reports. The values the model may type SHALL come from the written step, not from the joined sentence. The next step SHALL still run as written, as its own step.

#### Scenario: A submit followed by a check is judged on the check
- **WHEN** a test has `submit the add-note form` followed by `verify the note "Check the invoice" appears in the notes list`, and the model clicks "Add note" and answers `done`
- **THEN** the `done` is judged on the joined sentence, and the step closes only if the note is in the list

#### Scenario: The acting model never reads the check
- **WHEN** such a step runs
- **THEN** every request to the acting model names the step as `submit the add-note form`

#### Scenario: A step about to fail is judged on the check first
- **WHEN** the model clicks "Add note", then answers `fail` because the form is empty, and the note is in the list
- **THEN** the step is judged on the joined sentence and passes

#### Scenario: A step that did nothing is not rescued
- **WHEN** the model answers `fail` before any action succeeded
- **THEN** the step fails without a judgment

#### Scenario: A check that does not hold still fails
- **WHEN** a test has `open the shop page` followed by `verify the page says "Mechanical Keyboard added to cart."`, and nothing was added
- **THEN** the step or the check fails

#### Scenario: The report shows the step as written
- **WHEN** such a step runs
- **THEN** the console log and the reports name it `submit the add-note form`, and the check runs and is reported as its own step

#### Scenario: A value only the check names cannot be typed
- **WHEN** the model tries to fill a field with `Check the invoice`, a value named only by the next step and shown nowhere on the pages it read
- **THEN** the fill is refused as an invented value

#### Scenario: A step followed by another action is not joined
- **WHEN** a step `choose HSBC as the account` is followed by `choose Home Depot as the payee`
- **THEN** it runs as written and closes on `done` as before

#### Scenario: Setup does not join into steps
- **WHEN** the last setup step is an action and the first test step is a check
- **THEN** the setup step runs as written
