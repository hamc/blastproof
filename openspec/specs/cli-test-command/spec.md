# cli-test-command Specification

## Purpose

The diff-driven one-shot: verify what the change can break, draft what nothing covers, and gate on what was actually verified.

## Requirements

### Requirement: One-shot pipeline
The `test` command SHALL support `--base <ref>` (default `main`) and run the full diff-driven pipeline: compute affected routes, execute the tests covering them, generate drafts for affected routes no test covers, then report and score.

#### Scenario: Impacted tests run and gaps are drafted
- **WHEN** the diff affects `/cart`, which a test covers, and `/settings`, which none covers
- **THEN** the `/cart` test executes and a draft is generated for `/settings`

#### Scenario: Nothing affected
- **WHEN** the diff affects no mapped route
- **THEN** no test executes, no draft is generated, and the command exits 0

### Requirement: Generated drafts are never executed
Drafts produced by `test` SHALL be reported but SHALL NOT be executed, and SHALL NOT contribute to the score.

#### Scenario: Draft does not affect the score
- **WHEN** one covered test passes and a draft is generated for an uncovered route
- **THEN** the score reflects only the executed test and the draft is listed separately

#### Scenario: Executed and drafted are distinguished
- **WHEN** the command finishes
- **THEN** the output separates tests that executed from routes that were only drafted

### Requirement: Draft persistence
Without `--write`, drafts SHALL be printed and no file created; with `--write`, they SHALL be persisted under `.blastproof/tests/` without ever overwriting an existing file.

#### Scenario: Preview leaves disk untouched
- **WHEN** `blastproof test` runs without `--write` and a draft is generated
- **THEN** the draft is printed and `.blastproof/tests/` is unchanged

#### Scenario: Persisted for review
- **WHEN** `blastproof test --write` generates a draft for `/settings`
- **THEN** `.blastproof/tests/settings.yaml` is created and its path reported

### Requirement: Composed flags
The `test` command SHALL accept `--url`, `--min-score`, `--junit [path]` and `--html [path]`, with the same meaning they carry on `run`.

#### Scenario: Gate applies to the pipeline
- **WHEN** `blastproof test --min-score 80` executes tests scoring 60
- **THEN** the command exits 1 and the output states the score and the threshold

#### Scenario: Reports written
- **WHEN** `blastproof test --junit junit.xml --html report.html` finishes
- **THEN** both files are written and their paths reported

### Requirement: Exit codes
The `test` command SHALL exit 2 on usage, config or diff errors; 1 when the run fails its gate or when a draft could not be generated; and 0 otherwise.

#### Scenario: Generation failure fails the command
- **WHEN** every executed test passes but a draft cannot be generated for an uncovered route
- **THEN** the command exits 1 and names the route and the reason

#### Scenario: Clean pipeline
- **WHEN** all executed tests pass, any threshold is met and every draft is generated
- **THEN** the command exits 0
