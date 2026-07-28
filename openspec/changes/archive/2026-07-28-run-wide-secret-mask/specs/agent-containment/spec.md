# Spec delta: agent-containment (run-wide-secret-mask)

## MODIFIED Requirements

### Requirement: Secrets never reach the model
Steps SHALL retain their `{{env.*}}` placeholders when passed to the model, and the referenced values SHALL be substituted only when the action is performed. Every value referenced anywhere in the run — by any test and by the authentication recipe — SHALL be masked from every prompt sent by any command, including the planner's, and SHALL be masked in its percent-encoded form as well as literally.

#### Scenario: Placeholder is what the model sees
- **WHEN** a step reads `fill the password field with {{env.TEST_PASSWORD}}`
- **THEN** the prompt sent to the provider contains the placeholder and not the value

#### Scenario: The real value is typed
- **WHEN** the model returns a fill action carrying that placeholder
- **THEN** the substituted value is typed into the field

#### Scenario: Missing variable still fails before the browser
- **WHEN** a step references a variable that is not set
- **THEN** the test fails with an error naming the variable, before a page is opened

#### Scenario: Authentication follows the same rule
- **WHEN** an `auth.steps` recipe references `{{env.*}}`
- **THEN** the login journey's prompts carry placeholders, not credentials

#### Scenario: The authentication credential is masked in later prompts
- **WHEN** an authenticated page renders the credential used to sign in, during an ordinary test
- **THEN** it is masked before the snapshot reaches the model

#### Scenario: The planner masks too
- **WHEN** `plan` drafts a test for a route whose page renders a secret
- **THEN** that value is masked before the snapshot reaches the model

#### Scenario: Encoded forms are masked
- **WHEN** an action reports a URL in which a secret appears percent-encoded
- **THEN** the encoded form is masked before that string reaches the model
