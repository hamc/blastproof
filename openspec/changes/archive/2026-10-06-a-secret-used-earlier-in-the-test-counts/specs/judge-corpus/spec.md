# Spec delta: judge-corpus (a-secret-used-earlier-in-the-test-counts)

## ADDED Requirements

### Requirement: A case carries the secrets used before its step
A corpus case MAY list, by variable name, the secrets used in the actions of the steps before the one it judges. The replay SHALL hand them to the judgment exactly as the executor does. A case without the list SHALL be judged as if none were used.

#### Scenario: A login step whose password was typed earlier
- **WHEN** #141's case is replayed with `DEMO_EMAIL` and `DEMO_PASSWORD` listed as used earlier
- **THEN** its expected verdict, PASS, is what the judgment returns on a correct judge
