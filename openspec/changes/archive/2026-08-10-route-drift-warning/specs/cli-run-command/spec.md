# Spec delta: cli-run-command (route-drift-warning)

## ADDED Requirements

### Requirement: Route drift warnings
The `run` command SHALL report route drift to standard error on every run — plain `run`, `--dry-run`, and `--impacted` — because drift is independent of the diff and of selection. Drift warnings SHALL be non-fatal and SHALL NOT change the exit code. Each warning SHALL name the test, the drifted route, and state that the route is declared by no `routes:` mapping and contributes nothing to `--impacted` selection.

#### Scenario: Plain run reports drifted routes
- **WHEN** the user runs `blastproof run` (no `--impacted`, no `--dry-run`) and a test declares a route no `routes:` mapping declares
- **THEN** the console warns on stderr about the drifted route, because drift is independent of the diff and of selection

#### Scenario: Dry run reports drifted routes
- **WHEN** the user runs `blastproof run --impacted --dry-run` and a test declares `/cart/` while config maps to `/cart`
- **THEN** the console warns on stderr that `/cart/` is declared by no `routes:` mapping and contributes nothing to `--impacted` selection, and the exit code is unaffected

#### Scenario: Impacted run reports drifted routes
- **WHEN** the user runs `blastproof run --impacted` and a test declares a route no mapping declares
- **THEN** the console warns on stderr naming the test and the route

#### Scenario: Dry run without --impacted reports drifted routes
- **WHEN** the user runs `blastproof run --dry-run` (no `--impacted`) and a test declares a route no `routes:` mapping declares
- **THEN** the console warns on stderr about the drifted route, because drift is independent of the diff
