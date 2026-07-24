# Spec: project-init

## ADDED Requirements

### Requirement: Scaffold .blastproof directory
The CLI SHALL provide an `init` command that creates a `.blastproof/` directory in the current working directory containing a default `config.yaml`, a `tests/` directory, and one sample test file.

#### Scenario: Fresh initialization
- **WHEN** the user runs `blastproof init` in a directory without `.blastproof/`
- **THEN** the CLI creates `.blastproof/config.yaml` with commented defaults (base_url, llm provider/model/api_key_env, browser settings, routes hints) and `.blastproof/tests/app-load.yaml` with a valid sample test

#### Scenario: Idempotent re-run
- **WHEN** the user runs `blastproof init` in a directory that already has `.blastproof/`
- **THEN** the CLI SHALL NOT overwrite existing files and SHALL report which files were kept

### Requirement: Init validation feedback
The CLI SHALL print next-step guidance after scaffolding (set API key env var, edit base_url, run `blastproof run`).

#### Scenario: Guidance printed
- **WHEN** `blastproof init` completes successfully
- **THEN** the output includes the required env var name for the default provider and the command to run tests
