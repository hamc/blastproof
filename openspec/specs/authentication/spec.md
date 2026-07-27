# authentication Specification

## Purpose

Reach the part of a product that lives behind a login: sign in once per run through a strategy that fits the app, and reuse that session for every test and for the planner.

## Requirements

### Requirement: Optional authentication recipe
The system SHALL accept an optional `auth` section in `.blastproof/config.yaml`. When it is absent, every test and every planner page load SHALL run in an empty browser context, exactly as when the section did not exist.

#### Scenario: No recipe configured
- **WHEN** the config has no `auth` section
- **THEN** no authentication is attempted and contexts start empty

### Requirement: Interchangeable strategies
The system SHALL support exactly one of three strategies per configuration, selected by which field is present: `steps` (a plain-English login journey), `storage_state` (a path to a previously captured Playwright storage state), or `headers` and/or `cookies` (static values). Configuring more than one SHALL be rejected as a config error naming the conflicting fields.

#### Scenario: Login journey
- **WHEN** `auth.steps` describes filling a form and submitting it
- **THEN** the journey is executed once and the resulting session is captured

#### Scenario: Pre-captured state
- **WHEN** `auth.storage_state` points at a readable state file
- **THEN** that state is used and no login journey is executed

#### Scenario: Token-based auth
- **WHEN** `auth.headers` sets an `Authorization` value
- **THEN** contexts send that header and no browser login is performed

#### Scenario: Conflicting strategies rejected
- **WHEN** both `auth.steps` and `auth.storage_state` are configured
- **THEN** the CLI exits with code 2 and an error naming both fields

#### Scenario: Unreadable state file
- **WHEN** `auth.storage_state` names a file that cannot be read
- **THEN** the CLI exits with code 2 and an error naming the path

### Requirement: Authenticate once per run
Authentication SHALL be performed at most once per run, before the first test, and its session SHALL seed every test context and every planner page load.

#### Scenario: One login for many tests
- **WHEN** a run executes five authenticated tests
- **THEN** the login journey is executed once

#### Scenario: Planner reaches authenticated pages
- **WHEN** a draft is generated for a route that requires a session
- **THEN** the page is loaded with the authenticated session rather than snapshotting the login wall

### Requirement: Test isolation is preserved
Each test SHALL still run in its own browser context; the shared session seeds that context and SHALL NOT allow state written by one test to reach another.

#### Scenario: No leakage between tests
- **WHEN** one test writes to local storage and a later test runs
- **THEN** the later test starts from the authenticated session without the first test's additions

### Requirement: Per-test opt-out
A test SHALL be able to run unauthenticated by declaring `auth: false`, receiving an empty context.

#### Scenario: A login test starts logged out
- **WHEN** an `auth` recipe is configured and a test declares `auth: false`
- **THEN** that test runs in an empty context and can exercise the login flow itself

### Requirement: Verification
When `auth.verify` is configured, the system SHALL check that expectation against the page after authenticating and SHALL treat a negative result as an authentication failure.

#### Scenario: Verification passes
- **WHEN** `auth.verify` expects a signed-in indicator and it is present
- **THEN** the run proceeds to the tests

#### Scenario: Verification fails
- **WHEN** the credentials are wrong and `auth.verify` is not satisfied
- **THEN** the run stops before executing any test, with an error stating that authentication failed and why

### Requirement: Authentication failure aborts the run
A failed authentication SHALL abort with exit code 2 before any test executes, SHALL NOT be reported as failing tests, and SHALL NOT contribute to the score.

#### Scenario: Login journey cannot complete
- **WHEN** the login journey fails
- **THEN** the CLI exits 2 with an actionable message, no test runs, and no score is reported as if tests had failed

### Requirement: The captured session is a credential
A captured storage state SHALL be written under `.blastproof/`, SHALL be git-ignored by `init`, and SHALL never be printed, logged or embedded in a report. Values substituted from `{{env.*}}` inside `auth.steps` SHALL be masked in all output.

#### Scenario: State file is ignored by git
- **WHEN** `blastproof init` scaffolds a project
- **THEN** the captured state path is covered by `.gitignore`

#### Scenario: Credentials masked on failure
- **WHEN** a login journey using `{{env.TEST_PASSWORD}}` fails part-way
- **THEN** the substituted password appears nowhere in the output

### Requirement: Session caching is opt-in
The system SHALL re-authenticate on every run unless `auth.cache` is enabled, in which case a previously captured state SHALL be reused when present.

#### Scenario: Default re-authenticates
- **WHEN** `auth.cache` is not set and a state file from an earlier run exists
- **THEN** authentication is performed again and the state is replaced

#### Scenario: Caching reuses the session
- **WHEN** `auth.cache` is enabled and a previously captured state exists
- **THEN** no login journey is executed and the stored session is used
