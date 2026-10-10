# github-action Specification

## Purpose

Carry the pipeline knowledge — install, browser, provider wiring, checkout depth — so consuming blastproof in a workflow is a few lines rather than twenty.

## Requirements

### Requirement: Composite action interface
The repository SHALL provide a composite GitHub Action accepting inputs for the run (`command`, `base`, `min-score`, `url`, `junit`, `html`, `fail-on-unmapped`, `write`), for the provider (`api-key`, `provider`, `model`, `llm-base-url`), and for setup (`version`, `install-browser`, `working-directory`).

#### Scenario: Minimal usage
- **WHEN** a workflow uses the action with only `api-key`
- **THEN** the action installs blastproof, installs Chromium and runs the default command

#### Scenario: Input names mirror the CLI
- **WHEN** a user knows a CLI flag such as `--min-score`
- **THEN** the corresponding input is named `min-score`

### Requirement: Provider settings reach the CLI without a config file
Provider inputs SHALL be passed through the `BLASTPROOF_*` environment overrides, and `api-key` SHALL be bridged onto the `api_key_env` indirection rather than read directly by the CLI.

#### Scenario: Key supplied as an input
- **WHEN** a workflow passes `api-key: ${{ secrets.ANTHROPIC_API_KEY }}`
- **THEN** the run authenticates with that key and the repository's committed config is not modified

#### Scenario: Provider overridden
- **WHEN** a workflow sets `provider`, `model` and `llm-base-url`
- **THEN** the run uses them in preference to the committed config

### Requirement: Shallow checkout guard
When the selected command computes a diff, the action SHALL verify the checkout is not shallow before running, and SHALL fail with a message naming `fetch-depth: 0` when it is.

#### Scenario: Shallow clone rejected early
- **WHEN** the workflow checked out with the default depth and the command needs a merge-base
- **THEN** the action fails immediately with an error naming `fetch-depth: 0`, before installing anything

#### Scenario: Full clone accepted
- **WHEN** the workflow checked out with `fetch-depth: 0`
- **THEN** the action proceeds

### Requirement: Score output
The action SHALL expose the run score as an output, read from the JUnit report it produces.

#### Scenario: Score available to a later step
- **WHEN** a run scores 85
- **THEN** a following step reads `85` from the action's `score` output

#### Scenario: No report produced
- **WHEN** the run fails before writing a report
- **THEN** the `score` output is empty rather than a fabricated number

### Requirement: The action can be listed on the Marketplace
The action's `name` SHALL be one the GitHub Marketplace accepts: it SHALL NOT match a GitHub account it is not published by, so it contains a space, which no account name can. Its `description` SHALL be under 125 characters and SHALL say that the action tests pull requests.

#### Scenario: The listing name cannot collide with an account
- **WHEN** the action's metadata is validated for a Marketplace release
- **THEN** its name contains a space and is not `blastproof`, which an organization not ours holds

### Requirement: The documented pins name the current release
Every `hamc/blastproof@vX.Y.Z` reference and every `version:` input in `docs/ci.md` SHALL equal the version in `package.json`, and a test SHALL fail when one does not.

#### Scenario: A stale CLI pin fails the build
- **WHEN** `docs/ci.md` pins `version: '0.11.0'` while `package.json` is at 0.24.0
- **THEN** the test fails naming the stale pin
