# Spec delta: impact-mapping (route-drift-warning)

## ADDED Requirements

### Requirement: Route drift detection
When `.blastproof/config.yaml` declares at least one `routes:` mapping, the system SHALL detect test-declared routes that no `routes:` mapping declares and SHALL expose them as a drift set. Route comparison SHALL be exact equality against the set of routes declared as values across all `routes:` mappings; no normalization (trailing slash, case) SHALL be applied. Drift detection SHALL NOT alter test selection.

#### Scenario: Trailing-slash drift is detected
- **WHEN** config maps a glob to `["/cart"]` and a test declares `routes: ["/cart/"]`
- **THEN** `/cart/` is detected as drift because no mapping declares it

#### Scenario: No drift when routes match exactly
- **WHEN** every test-declared route appears as a value in some `routes:` mapping
- **THEN** no drift is detected

#### Scenario: No drift detection without routes mappings
- **WHEN** config has no `routes:` entries
- **THEN** drift detection does not run, so a suite using routes as metadata is not flagged

#### Scenario: A valid route absent from the diff is not drift
- **WHEN** config maps a glob to `["/cart"]`, a test declares `routes: ["/cart"]`, and the diff affects only `/login`
- **THEN** `/cart` is not drift, because it is declared by a mapping (drift is independent of the current diff)
