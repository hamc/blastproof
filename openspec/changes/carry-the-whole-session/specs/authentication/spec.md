## ADDED Requirements

### Requirement: The captured session is the whole session
A session captured by `auth.steps` SHALL hold the cookies, local storage and IndexedDB of the browser it signed in with, and the session storage of the origin the login ended on. Every context seeded with it SHALL start with all of them. A key or value the browser automation library fails to capture SHALL be recovered from the page the login ended on, so the state restores as it was.

#### Scenario: A session kept in IndexedDB
- **WHEN** an application keeps its session only in IndexedDB and a login journey signs in
- **THEN** a test seeded with the captured session starts signed in

#### Scenario: A falsy key survives capture
- **WHEN** an IndexedDB store holds a record under the key `0`
- **THEN** the captured state holds that record with its key, and a context seeded with it restores without error

#### Scenario: The application writes while the session is captured
- **WHEN** the page's IndexedDB changes between the capture and the read that recovers falsy entries
- **THEN** the session is captured again, and after three captures that disagree the login fails with a message saying the application kept writing to its IndexedDB

#### Scenario: Session storage reaches a test
- **WHEN** the application keeps a value in session storage at the end of the login
- **THEN** a page of that origin in a seeded context finds the value in session storage

#### Scenario: Session storage is seeded once per tab
- **WHEN** a test's page removes a seeded session-storage key and navigates within the same origin
- **THEN** the key is not written back

### Requirement: The sign-in is verified where it is used
When `auth.verify` is configured, the system SHALL, after the login passes it, judge it again on the page the login ended on, in a new context seeded only with the captured session. A negative result SHALL be an authentication failure whose message says the session did not survive capture.

#### Scenario: A session that does not survive capture
- **WHEN** the login passes `auth.verify` and a context seeded with the captured session is not signed in
- **THEN** the CLI exits 2 before any test runs, with a message saying the captured session does not keep the sign-in

#### Scenario: A session that survives
- **WHEN** a context seeded with the captured session satisfies `auth.verify`
- **THEN** the run proceeds to the tests

#### Scenario: No verify, no second check
- **WHEN** `auth.verify` is not configured
- **THEN** no second judgment is made

## MODIFIED Requirements

### Requirement: Session caching is opt-in
The system SHALL re-authenticate on every run unless `auth.cache` is enabled, in which case a previously captured state SHALL be reused when present, its session storage included.

#### Scenario: Default re-authenticates
- **WHEN** `auth.cache` is not set and a state file from an earlier run exists
- **THEN** authentication is performed again and the state is replaced

#### Scenario: Caching reuses the session
- **WHEN** `auth.cache` is enabled and a previously captured state exists
- **THEN** no login journey is executed and the stored session is used, session storage included
