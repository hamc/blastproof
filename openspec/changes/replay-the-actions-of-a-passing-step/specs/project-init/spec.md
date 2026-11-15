## ADDED Requirements

### Requirement: The scaffolded .gitignore ignores saved actions
The `.gitignore` that `init` writes SHALL ignore `.blastproof/cache/`. An existing `.gitignore` SHALL NOT be modified.

#### Scenario: New project
- **WHEN** `init` runs in a directory with no `.gitignore`
- **THEN** the one it writes contains `.blastproof/cache/`
