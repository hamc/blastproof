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
Generated steps that require a credential, or any value that identifies an account or a person — an email address, a username, an account or customer number — SHALL use `{{env.VAR_NAME}}` placeholders and SHALL NOT contain a literal for it, whether real or invented.

The instruction to the model SHALL state this as a property of the value rather than as a list of credential types, so that a value the list does not name is still covered.

A generated step that names a credential and carries no placeholder SHALL be refused when it contains a quoted literal **or when it enters a value**, as `run`'s authoring check defines entering one: a leading value verb followed by a value it names. Quoting SHALL NOT be what separates a refused secret from an accepted one.

#### Scenario: Login step uses a placeholder
- **WHEN** a generated draft includes a password entry step
- **THEN** the step references `{{env.VAR_NAME}}` rather than an inline value

#### Scenario: An unquoted literal password is refused
- **WHEN** a generated step reads "fill the Password textbox with demo123"
- **THEN** generation fails for that route with an error naming the step, exactly as for a quoted literal

#### Scenario: Naming a credential field without entering a value is not refused
- **WHEN** a generated step reads "verify the password field is visible"
- **THEN** the draft is accepted

#### Scenario: The account being signed in as is a placeholder too
- **WHEN** a generated draft includes a step entering the email address or username to sign in with
- **THEN** the instruction the model received requires a `{{env.VAR_NAME}}` placeholder for that value as well as for the password

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
A failure affecting one route SHALL NOT prevent generation for the remaining routes. This SHALL hold for a failure to persist a draft as well as a failure to generate one, and SHALL NOT depend on which kind of error was raised: every draft is a model call against a live page, so the routes still to come are worth more than any distinction between one filesystem fault and another.

#### Scenario: One route fails to load
- **WHEN** generation is requested for `/cart` and `/settings` and `/settings` fails to load
- **THEN** `/cart` still produces a draft and `/settings` is reported as failed with its reason

#### Scenario: One route fails to persist
- **WHEN** three routes are generated with `--write` and the second cannot be written
- **THEN** the third is still attempted, the second is reported as failed with its reason, and the run exits non-zero

#### Scenario: A write failure the command does not recognise
- **WHEN** persisting a draft raises an error of a kind the command does not handle
- **THEN** that route is reported as failed and the remaining routes are still attempted, rather than the run ending with no summary

### Requirement: A generated step states its own outcome
Every generated step SHALL name what should be true once it has been carried out, rather than naming an action alone. A step that supplies a value to the application SHALL write that value, because the executor refuses to invent one.

This is the rule the documentation teaches for hand-written tests, and a draft is also a worked example of it: a step that names an action without an outcome asks the judge to decide whether something happened while looking at the state that succeeding produces, which is the shape behind three separate defects.

Whether a plain-English step states an outcome SHALL NOT be validated mechanically. It is not decidable by a parser, and a heuristic would reject good drafts and accept bad ones silently at generation time. Drafts are printed for review and require an explicit flag to be written; that review is the check.

#### Scenario: An action carries its outcome
- **WHEN** a draft includes a step that submits a form
- **THEN** that step also names what should be true afterwards, rather than naming the submission alone

#### Scenario: A step that fills carries its value
- **WHEN** a draft includes a step that enters text into a field
- **THEN** the step names the value to enter, rather than leaving it for the agent to invent

#### Scenario: Drafts are not rejected mechanically
- **WHEN** a generated step does not obviously state an outcome
- **THEN** generation still succeeds and the draft is printed for review, rather than being refused by a heuristic

### Requirement: An invented email address in a draft is reported
When a generated step contains an email address that does not appear in the page snapshot the draft was generated from, `plan` SHALL report it on stderr, naming the route and the step. The draft SHALL still be written or previewed exactly as without the report, and the exit code SHALL NOT change.

An email address that does appear in the snapshot SHALL NOT be reported: verifying a contact address the page shows is a legitimate step.

The report covers email addresses only. No other identifier SHALL be matched by shape, and the documentation SHALL say that usernames and account numbers remain guidance.

#### Scenario: The observed case is reported
- **WHEN** a draft for `/#/login` contains "fill the email field with test@example.com" and the login page does not show that address
- **THEN** `plan` reports that step for that route, and the draft is still produced

#### Scenario: An address read off the page is not reported
- **WHEN** a draft contains "verify the footer shows support@acme.test" and the snapshot contains that address
- **THEN** nothing is reported

#### Scenario: A placeholder is not reported
- **WHEN** a draft step contains `{{env.TEST_EMAIL}}` and no literal address
- **THEN** nothing is reported

#### Scenario: A clean draft prints nothing extra
- **WHEN** no step contains an email address absent from the snapshot
- **THEN** `plan`'s output is unchanged
