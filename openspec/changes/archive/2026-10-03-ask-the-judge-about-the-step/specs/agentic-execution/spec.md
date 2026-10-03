# Spec delta: agentic-execution (ask-the-judge-about-the-step)

## ADDED Requirements

### Requirement: The judge reads a placeholder as its label
Before a judgment, every `{{env.NAME}}` placeholder in the step, the model's expectation and the step's record SHALL be rewritten as the label the mask gives that variable's value, `[redacted NAME]`, so that the step and the page are compared in one vocabulary. The rewrite SHALL happen inside the judgment itself, so every caller of it gets the same view.

The rewrite SHALL apply only to what the judge reads. What the executor's model reads, and the value it types, SHALL be unchanged.

#### Scenario: A step naming one secret is not satisfied by a page showing another
- **WHEN** a step verifies the account menu shows `{{env.TEST_OTHER}}`, and the menu shows the value of `TEST_EMAIL`
- **THEN** the judge reads `[redacted TEST_OTHER]` in the step and `[redacted TEST_EMAIL]` on the page, and the step fails

#### Scenario: A step naming the secret the page shows still passes
- **WHEN** a step verifies the account menu shows `{{env.TEST_EMAIL}}`, and the menu shows that value
- **THEN** the judge reads `[redacted TEST_EMAIL]` on both sides, and the step passes

#### Scenario: The executor still types the placeholder
- **WHEN** a step fills a field with `{{env.TEST_PASSWORD}}`
- **THEN** the executor's model is shown the placeholder and the real value is typed, as before

### Requirement: A step naming one secret cannot pass on a page showing only another
A judgment SHALL NOT pass a step that names a redacted value `[redacted X]` when that label appears neither in the snapshot nor in the step's own record, and the snapshot shows a different label. In that state the only thing on the page that could stand for X is another secret, which is the mistake this rules out; the step SHALL fail with a reason saying so, naming both labels.

The check SHALL be made on the step as the judge reads it, after placeholders are rewritten as labels, and SHALL apply to every judgment. It SHALL NOT apply when the snapshot shows no other label, so a step asserting that a secret is absent from a page showing none is judged as before.

#### Scenario: Another secret on the page does not satisfy the step
- **WHEN** a step verifies the account menu shows `{{env.TEST_OTHER}}`, the menu shows `[redacted TEST_EMAIL]`, and the judge's verdict is PASS
- **THEN** the step fails, with a reason naming `[redacted TEST_OTHER]` and `[redacted TEST_EMAIL]`

#### Scenario: A secret the step itself typed is found in its record
- **WHEN** a step types `{{env.TEST_EMAIL}}` into a login form, submits it, and verifies the dashboard is shown, and the dashboard shows `[redacted TEST_PASSWORD]` somewhere but not the email
- **THEN** the check does not fail the step, because `[redacted TEST_EMAIL]` is in the step's own record

#### Scenario: A page with no other secret is judged as before
- **WHEN** a step verifies `{{env.TEST_PASSWORD}}` is not shown, and the snapshot carries no redaction label at all
- **THEN** the judge's verdict stands

## MODIFIED Requirements

### Requirement: A step's outcome cannot be satisfied by substituting an easier claim
Because the judgment is anchored to the step rather than to whatever the model most recently proposed, a model SHALL NOT be able to close a step whose outcome has not been reached by offering a different claim that happens to hold. Retrying after a failed judgment SHALL continue to be judged against the same step.

The judgment's own response format SHALL ask the same question: whether the snapshot shows the **step's** outcome, the expectation being only a claim offered in support. It SHALL fail when any part of the outcome the step asks for is not shown, or cannot be assessed from the snapshot. Its reason SHALL be produced before its verdict.

#### Scenario: Substitution after a failed judgment
- **WHEN** an expectation fails because the step's outcome has not been reached, and the model then offers an unrelated claim that is true of the page
- **THEN** the judgment still fails, because the step's outcome is what is being decided

#### Scenario: A weakened expectation does not lower the bar
- **WHEN** a step asks to open the Account menu and verify the email it shows, and the model offers "the page redirected away from login, or the Account menu is accessible", and only the redirect is shown
- **THEN** the judgment fails, because the step's outcome is not shown

#### Scenario: A legitimate second attempt still works
- **WHEN** an expectation fails because the page had not yet reached the state the step describes, and the state is reached on a later attempt
- **THEN** the judgment passes, because the step's outcome now holds

#### Scenario: The expectation remains visible
- **WHEN** any judgment is recorded
- **THEN** the model's expectation and the judge's reason are still reported, so a reader can see what was claimed as well as what was decided
