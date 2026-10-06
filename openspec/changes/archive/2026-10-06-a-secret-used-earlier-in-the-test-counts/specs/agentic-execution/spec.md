# Spec delta: agentic-execution (a-secret-used-earlier-in-the-test-counts)

## MODIFIED Requirements

### Requirement: A step naming one secret cannot pass on a page showing only another
A judgment SHALL NOT pass a step that names a redacted value `[redacted X]` when that label appears neither in the snapshot, nor in the step's own record, nor among the variables used in the actions of the test's earlier steps, and the snapshot shows a different label. The variables used earlier SHALL be handed to the judgment by name only, from the masked record, and SHALL NOT enter the model's prompt. In that state the only thing on the page that could stand for X is another secret, which is the mistake this rules out; the step SHALL fail with a reason saying so, naming both labels.

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

#### Scenario: A secret typed in an earlier step is accounted for
- **WHEN** an earlier step filled the password field with `{{env.DEMO_PASSWORD}}`, and a later step says "log in with {{env.DEMO_EMAIL}} and {{env.DEMO_PASSWORD}} and verify the page shows a welcome heading" on a page already showing it and `[redacted DEMO_EMAIL]`
- **THEN** the check does not fail the step, and the judge's verdict stands

#### Scenario: A secret used nowhere in the test is still caught
- **WHEN** earlier steps typed `{{env.TEST_EMAIL}}` and `{{env.TEST_PASSWORD}}`, and a step verifies the account menu shows `{{env.TEST_OTHER}}` on a page showing `[redacted TEST_EMAIL]`
- **THEN** the step fails, as before

