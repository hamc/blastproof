# Spec delta: test-generation (an-account-identifier-is-a-placeholder-too)

## MODIFIED Requirements

### Requirement: Secrets are emitted as placeholders
Generated steps that require a credential, or any value that identifies an account or a person — an email address, a username, an account or customer number — SHALL use `{{env.VAR_NAME}}` placeholders and SHALL NOT contain a literal for it, whether real or invented.

The instruction to the model SHALL state this as a property of the value rather than as a list of credential types, so that a value the list does not name is still covered.

#### Scenario: Login step uses a placeholder
- **WHEN** a generated draft includes a password entry step
- **THEN** the step references `{{env.VAR_NAME}}` rather than an inline value

#### Scenario: The account being signed in as is a placeholder too
- **WHEN** a generated draft includes a step entering the email address or username to sign in with
- **THEN** the instruction the model received requires a `{{env.VAR_NAME}}` placeholder for that value as well as for the password

## ADDED Requirements

### Requirement: An invented email address in a draft is reported
When a generated step contains an email address that does not appear in the page snapshot the draft was generated from, `plan` SHALL report it on stderr, naming the route and the step. The draft SHALL still be written or previewed exactly as without the report, and the exit code SHALL NOT change.

An email address that does appear in the snapshot SHALL NOT be reported: verifying a contact address the page shows is a legitimate step.

The report covers email addresses only. No other identifier SHALL be matched by shape, and the documentation SHALL say that usernames and account numbers remain guidance.

#### Scenario: The observed case is reported
- **WHEN** a draft for `/#/login` contains "fill the email field with test@example.com" and the login page does not show that address
- **THEN** `plan` reports that step for that route, and the draft is still produced

#### Scenario: An address read off the page is not reported
- **WHEN** a draft contains "verify the footer shows support@acme.test" and the snapshot contains that address
- **THEN** nothing is reported

#### Scenario: A placeholder is not reported
- **WHEN** a draft step contains `{{env.TEST_EMAIL}}` and no literal address
- **THEN** nothing is reported

#### Scenario: A clean draft prints nothing extra
- **WHEN** no step contains an email address absent from the snapshot
- **THEN** `plan`'s output is unchanged
