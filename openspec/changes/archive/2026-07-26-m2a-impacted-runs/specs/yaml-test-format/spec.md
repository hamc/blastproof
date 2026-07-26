# Spec delta: yaml-test-format (m2a-impacted-runs)

## MODIFIED Requirements

### Requirement: YAML test file schema
The system SHALL parse `.yaml`/`.yml` test files with required fields `summary` (string) and `steps` (non-empty list of plain-English strings), and optional fields `priority` (P0|P1|P2, default P1), `tags` (list of strings), `setup` (list of steps executed before `steps`), and `routes` (list of route strings, default empty, declaring the routes/URLs the test covers for impact matching).

#### Scenario: Valid minimal test
- **WHEN** a test file contains only `summary` and `steps`
- **THEN** it parses successfully with priority defaulted to P1, empty tags and empty routes

#### Scenario: Test with route coverage
- **WHEN** a test file contains `routes: ["/cart", "/checkout"]`
- **THEN** it parses successfully and exposes the two routes as its coverage declaration

#### Scenario: Invalid file rejected
- **WHEN** a test file is missing `summary` or `steps`, or `steps` is empty
- **THEN** parsing fails with an error naming the file and the offending field
