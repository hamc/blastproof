# test-generation Specification

## Purpose

Turn a route with no test coverage into a runnable plain-English YAML test, grounded in the page's live accessibility tree and in the code the pull request changed.

## Requirements

### Requirement: Snapshot-grounded generation
The system SHALL generate a test draft for a route by loading `base_url + route` in the browser, capturing a trimmed accessibility snapshot, and passing that snapshot together with the repo-relative paths of the changed files that mapped to the route to a single structured LLM call returning `summary`, `steps`, `priority` and `tags`.

#### Scenario: Steps reference real elements
- **WHEN** the snapshot of `/cart` contains a button named "Apply discount"
- **THEN** the generated steps refer to that control by its accessible name rather than an invented one

#### Scenario: Diff context steers the draft
- **WHEN** the changed files mapped to `/cart` are `src/cart/discount.ts` and `src/cart/total.ts`
- **THEN** those paths are included in the generation prompt as the changed-area context for the route

#### Scenario: Route loaded before generation
- **WHEN** a draft is generated for route `/cart`
- **THEN** the browser navigated to `base_url + /cart` and the snapshot used is the one captured there

### Requirement: Generated route coverage is authoritative
The generated test's `routes:` field SHALL be set by the system to exactly the route the draft was generated for, and SHALL NOT be taken from the model output.

#### Scenario: Coverage gap is closed
- **WHEN** a draft is generated for the uncovered route `/settings`
- **THEN** the draft declares `routes: ["/settings"]` so a subsequent `run --impacted` selects it

### Requirement: Generated drafts are valid test files
Every generated draft SHALL conform to the `yaml-test-format` schema: a non-empty `summary`, at least one plain-English step, a `priority` of P0, P1 or P2, and a `tags` list.

#### Scenario: Draft parses as a test file
- **WHEN** a generated draft is written to `.blastproof/tests/`
- **THEN** parsing it with the standard test-file parser succeeds without error

#### Scenario: Malformed model output rejected
- **WHEN** the model returns output that does not satisfy the generation schema
- **THEN** generation fails for that route with an error naming the route, and no file is written for it

### Requirement: Secrets are emitted as placeholders
Generated steps that require a credential SHALL use `{{env.VAR_NAME}}` placeholders and SHALL NOT contain literal secret values.

#### Scenario: Login step uses a placeholder
- **WHEN** a generated draft includes a password entry step
- **THEN** the step references `{{env.VAR_NAME}}` rather than an inline value

### Requirement: Writing drafts never overwrites
When persisting drafts, the system SHALL derive the target filename from the route (`/` → `home`, other routes slugified to lowercase alphanumerics joined by `-`) under `.blastproof/tests/`, and SHALL fail that route with an error naming the existing file if the target already exists.

#### Scenario: New file written
- **WHEN** a draft for `/cart/discount` is persisted and no `.blastproof/tests/cart-discount.yaml` exists
- **THEN** the file is created with the draft contents

#### Scenario: Existing file preserved
- **WHEN** a draft for `/cart` is persisted and `.blastproof/tests/cart.yaml` already exists
- **THEN** the existing file is left untouched and that route is reported as failed with the conflicting path

### Requirement: Provenance header
Each persisted draft SHALL begin with a comment header recording the route it covers, the base ref used and the generation date.

#### Scenario: Header present
- **WHEN** a draft generated for `/cart` against base `main` is written
- **THEN** the file opens with a comment naming the route, the base ref and the date

### Requirement: Per-route isolation
A failure affecting one route SHALL NOT prevent generation for the remaining routes.

#### Scenario: One route fails to load
- **WHEN** generation is requested for `/cart` and `/settings` and `/settings` fails to load
- **THEN** `/cart` still produces a draft and `/settings` is reported as failed with its reason
