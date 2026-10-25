# yaml-test-format Specification

## Purpose

TBD - created by syncing change m1-yaml-runner. Update purpose after archive.

## Requirements

### Requirement: YAML test file schema
The system SHALL parse `.yaml`/`.yml` test files with required fields `summary` (string) and `steps` (non-empty list of plain-English strings), and optional fields `priority` (P0|P1|P2, default P1), `tags` (list of strings), `setup` (list of steps executed before `steps`), `routes` (list of route strings, default empty, declaring the routes/URLs the test covers for impact matching), `auth` (boolean, default true, declaring whether the test runs with the configured authenticated session), and `device` (the name of a device in Playwright's registry, which the test runs as instead of `browser.device`).

#### Scenario: Valid minimal test
- **WHEN** a test file contains only `summary` and `steps`
- **THEN** it parses successfully with priority defaulted to P1, empty tags, empty routes, `auth` defaulted to true and no device

#### Scenario: Test with route coverage
- **WHEN** a test file contains `routes: ["/cart", "/checkout"]`
- **THEN** it parses successfully and exposes the two routes as its coverage declaration

#### Scenario: Test opting out of authentication
- **WHEN** a test file contains `auth: false`
- **THEN** it parses successfully and the test runs in an unauthenticated context

#### Scenario: Test naming a device
- **WHEN** a test file contains `device: "Pixel 7"`
- **THEN** it parses successfully and the test runs as the Pixel 7

#### Scenario: Invalid file rejected
- **WHEN** a test file is missing `summary` or `steps`, or `steps` is empty, or `device` names no device in the registry
- **THEN** parsing fails with an error naming the file and the offending field

### Requirement: Environment variable placeholders
The system SHALL substitute `{{env.VAR_NAME}}` placeholders in step strings from process environment at execution time and SHALL mask the substituted values in all logs and reports, replacing each with a label naming its variable.

#### Scenario: Placeholder substitution
- **WHEN** a step contains `fill password with {{env.TEST_PASSWORD}}` and `TEST_PASSWORD` is set
- **THEN** the executor receives the real value and any logged output shows `[redacted TEST_PASSWORD]` in its place

#### Scenario: Missing env var
- **WHEN** a step references `{{env.MISSING_VAR}}` and it is not set
- **THEN** the test fails before browser launch with an error naming the missing variable
