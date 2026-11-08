## ADDED Requirements

### Requirement: An action step followed by a check is judged on that check

When a step is not a verification step, carries no verification clause, and the next step in the same list (`setup` or `steps`) is a verification step, the executor SHALL execute the step as the sentence `<step> and <next step>`, with the step's trailing period removed and the next step's first letter lowercased. The acting model and the judge SHALL read that sentence, and a `done` on it SHALL be judged as for any step carrying a verification clause.

The step SHALL keep its written text everywhere a person reads it: run events, the console log and the reports. The values the model may type SHALL come from the written step, not from the joined sentence. The next step SHALL still run as written, as its own step.

#### Scenario: A submit followed by a check is judged on the check
- **WHEN** a test has `submit the add-note form` followed by `verify the note "Check the invoice" appears in the notes list`, and the model clicks "Add note" and answers `done`
- **THEN** the `done` is judged against the page with the check as the step's outcome, and the step closes only if the note is in the list

#### Scenario: The report shows the step as written
- **WHEN** such a step runs
- **THEN** the console log and the reports name it `submit the add-note form`

#### Scenario: The check still runs as its own step
- **WHEN** the joined step passes
- **THEN** the next step, `verify the note "Check the invoice" appears in the notes list`, runs and is reported as its own step

#### Scenario: A value only the check names cannot be typed
- **WHEN** the model in the joined step tries to fill a field with `Check the invoice`, a value named only by the next step and shown nowhere on the pages it read
- **THEN** the fill is refused as an invented value

#### Scenario: A step followed by another action is not joined
- **WHEN** a step `choose HSBC as the account` is followed by `choose Home Depot as the payee`
- **THEN** it runs as written and closes on `done` as before

#### Scenario: Setup does not join into steps
- **WHEN** the last setup step is an action and the first test step is a check
- **THEN** the setup step runs as written
