# Spec delta: authentication (skip-a-login-nothing-selected-needs)

## MODIFIED Requirements

### Requirement: Authenticate once per run
Authentication SHALL be performed at most once per run, before the first test, and its session SHALL seed every test context and every planner page load.

It SHALL be performed only when the run can use it: when every test in the **selected** set declares `auth: false`, the system SHALL NOT authenticate, SHALL NOT establish a session, and SHALL NOT read the configured `storage_state`. This applies to every strategy, not only `auth.steps` — a session file that cannot be read SHALL NOT abort a run in which nothing would have read it.

The selected set is the one the run will execute, after filters and after `--impacted` selection. `plan` has no such set and SHALL continue to authenticate whenever `auth` is configured, because any route it drafts for may require a session.

#### Scenario: One login for many tests
- **WHEN** a run executes five authenticated tests
- **THEN** the login journey is executed once

#### Scenario: A selection that opted out logs in not at all
- **WHEN** every selected test declares `auth: false`
- **THEN** no login is performed and no session is established

#### Scenario: One authenticated test is enough
- **WHEN** a selection contains one test that wants the session and several that declare `auth: false`
- **THEN** the login journey is executed once, as it would be for a fully authenticated selection

#### Scenario: An unread storage state cannot fail the run
- **WHEN** `auth.storage_state` names a file that cannot be read and every selected test declares `auth: false`
- **THEN** the run proceeds and exits on its own result, rather than exiting 2 over a file nothing would have opened

#### Scenario: A needed storage state still fails the run
- **WHEN** `auth.storage_state` names a file that cannot be read and a selected test wants the session
- **THEN** the CLI exits with code 2 and an error naming the path, as before

#### Scenario: Verification follows the login
- **WHEN** `auth.verify` is configured and no login was performed
- **THEN** nothing is verified, because there is no session to verify

#### Scenario: Planner reaches authenticated pages
- **WHEN** a draft is generated for a route that requires a session
- **THEN** the page is loaded with the authenticated session rather than snapshotting the login wall
