# cli-plan-command Specification

## Purpose

The `plan` command surface: which routes get drafts, whether drafts are previewed or persisted, and how the outcome is reported.

## Requirements

### Requirement: Plan from the diff
The `plan` command SHALL support `--base <ref>` (default `main`), computing the diff and affected routes exactly as `run --impacted` does, and generating a test draft for each affected route that no existing test covers.

#### Scenario: Draft generated for an uncovered route
- **WHEN** the diff affects `/settings` and no test declares `routes: ["/settings"]`
- **THEN** a draft covering `/settings` is generated

#### Scenario: Covered routes are not regenerated
- **WHEN** the diff affects `/cart` and an existing test already declares `routes: ["/cart"]`
- **THEN** no draft is generated for `/cart`

#### Scenario: Nothing uncovered
- **WHEN** every affected route is already covered
- **THEN** the command reports that there is nothing to generate, launches no browser, and exits with code 0

### Requirement: Explicit route selection
The `plan` command SHALL support `--route <route>` (repeatable), generating drafts for the named routes and bypassing diff and impact analysis entirely.

#### Scenario: Bootstrap without a diff
- **WHEN** the user runs `blastproof plan --route /login --route /cart`
- **THEN** drafts are generated for both routes and no git diff is computed

### Requirement: Preview by default
Without `--write`, the `plan` command SHALL print each generated draft as YAML to stdout and SHALL NOT create or modify any file.

#### Scenario: Preview leaves disk untouched
- **WHEN** the user runs `blastproof plan --base main`
- **THEN** the drafts appear on stdout and `.blastproof/tests/` is unchanged

### Requirement: Persisting drafts
With `--write`, the `plan` command SHALL persist each generated draft under `.blastproof/tests/` and report the path of every file it created.

#### Scenario: Files created and reported
- **WHEN** the user runs `blastproof plan --base main --write` and two drafts are generated
- **THEN** two files are created under `.blastproof/tests/` and both paths are printed

### Requirement: Base URL override
The `plan` command SHALL support `--url <url>`, overriding the config `base_url` for that run only, with the config file left unchanged.

#### Scenario: Plan against a review environment
- **WHEN** the user runs `blastproof plan --route /cart --url https://preview-pr-42.example.com`
- **THEN** the route is loaded against the given URL and the config file is not modified

### Requirement: Exit codes
The `plan` command SHALL exit with code 0 when every requested route generated successfully or there was nothing to generate, 1 when at least one route failed to generate, and 2 on usage, config or diff errors.

#### Scenario: Partial failure exits 1
- **WHEN** one of two routes fails to generate
- **THEN** the successful draft is still reported and the process exits with code 1

#### Scenario: Invalid base ref exits 2
- **WHEN** the user passes `--base nonexistent-ref` and the ref does not exist
- **THEN** the CLI exits with code 2 and an actionable error before launching any browser

### Requirement: Reporting
The `plan` command SHALL report, for the run, the routes it generated for, the routes it skipped as already covered, and any routes that failed with their reason.

#### Scenario: Summary output
- **WHEN** a plan run finishes
- **THEN** the console lists generated routes, already-covered routes and failed routes with reasons
