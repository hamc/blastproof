## ADDED Requirements

### Requirement: Dry run
The `plan` command SHALL support `--dry-run`, printing the routes it would generate drafts for — and those already covered — without launching a browser or calling the LLM, exiting with code 0. This makes the coverage-gap answer available without a provider key, which is otherwise obtainable only from `run --impacted --dry-run`.

#### Scenario: Uncovered routes reported without a provider
- **WHEN** the user runs `blastproof plan --base main --dry-run`
- **THEN** the affected routes no test covers are printed, no browser is launched, no model is called, and the process exits 0

#### Scenario: Nothing to generate
- **WHEN** every affected route is already covered
- **THEN** the dry run says so and exits 0

#### Scenario: No key required
- **WHEN** a dry run is requested and no provider key is configured
- **THEN** the command still succeeds, because it needs no provider
