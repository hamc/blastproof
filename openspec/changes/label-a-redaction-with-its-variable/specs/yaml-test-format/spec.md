# Spec delta: yaml-test-format (label-a-redaction-with-its-variable)

## MODIFIED Requirements

### Requirement: Environment variable placeholders
The system SHALL substitute `{{env.VAR_NAME}}` placeholders in step strings from process environment at execution time and SHALL mask the substituted values in all logs and reports, replacing each with a label naming its variable.

#### Scenario: Placeholder substitution
- **WHEN** a step contains `fill password with {{env.TEST_PASSWORD}}` and `TEST_PASSWORD` is set
- **THEN** the executor receives the real value and any logged output shows `[redacted TEST_PASSWORD]` in its place

#### Scenario: Missing env var
- **WHEN** a step references `{{env.MISSING_VAR}}` and it is not set
- **THEN** the test fails before browser launch with an error naming the missing variable
