# agentic-execution Specification

## Purpose

TBD - created by syncing change m1-yaml-runner. Update purpose after archive.
## Requirements
### Requirement: Per-step agentic loop
The executor SHALL execute each plain-English step via a loop: capture the page accessibility snapshot, ask the LLM for a structured next action, perform the action on the page, and repeat until the step is complete or failed. A step SHALL be complete when the LLM returns `done` **or** when an `assert` judgment passes; the executor SHALL NOT request a further action once either has occurred. Where a run budget is configured, exhausting it SHALL end the run rather than fail the step, so an exhausted budget is never mistaken for a defect in the application under test.

#### Scenario: Step completes
- **WHEN** the LLM returns action `done` for a step
- **THEN** the executor records the step as passed and advances to the next step

#### Scenario: Step completes on a passing assertion
- **WHEN** an `assert` action's judgment passes
- **THEN** the executor records the step as passed and advances to the next step, without requesting a further action

#### Scenario: Step fails
- **WHEN** the LLM returns action `fail` or the retry budget is exhausted
- **THEN** the executor records the step as failed with the LLM-provided reason, captures a screenshot, and the test is marked failed

#### Scenario: A satisfied step cannot subsequently be failed
- **WHEN** a step's assertion has passed
- **THEN** the step is already complete, so no later `fail` can apply to it

#### Scenario: Budget exhausted mid-step
- **WHEN** the run budget is exhausted while a step is in progress
- **THEN** the run stops and is reported as incomplete, and the step is recorded as not run rather than as failed

### Requirement: Live element resolution
The executor SHALL resolve target elements exclusively from the current accessibility snapshot (role/name/text) on every action attempt and SHALL NOT persist selectors between steps or runs.

#### Scenario: Self-healing after UI change
- **WHEN** an action fails because the target element is not found
- **THEN** the executor retries with a fresh snapshot, allowing the LLM to pick an alternative element, up to the configured per-step retry budget (default 3)

### Requirement: Supported actions
The executor SHALL support the actions `navigate`, `click`, `fill`, `press`, `select`, `assert`, `done`, and `fail`, mapping them to Playwright operations resolved via `getByRole`/`getByLabel`/`getByText`. Action payloads SHALL have `{{env.*}}` placeholders substituted at the moment the action is performed, and `navigate` SHALL be bounded by the allowed origins.

#### Scenario: Assert judgment
- **WHEN** the LLM action is `assert` with an expectation
- **THEN** the LLM judges the current snapshot against the expectation and returns pass/fail with a reason, which the executor records

#### Scenario: Assert judgment passes
- **WHEN** an `assert` judgment returns pass
- **THEN** the executor records the result and treats the step as complete

#### Scenario: Assert judgment fails
- **WHEN** an `assert` judgment returns fail
- **THEN** the executor records the result and retries within the per-step retry budget, failing the step when the budget is exhausted

#### Scenario: Placeholder resolved at action time
- **WHEN** a fill action carries `{{env.TEST_PASSWORD}}` as its value
- **THEN** the environment value is substituted immediately before typing

#### Scenario: Navigation outside the allowed origins
- **WHEN** a navigate action resolves to an origin that is neither the application's nor declared
- **THEN** the action fails and the step records the rejection

### Requirement: Setup steps and browser lifecycle
The executor SHALL run optional `setup` steps before the test steps, start from the configured `base_url`, and run each test in a fresh browser context.

#### Scenario: Fresh context per test
- **WHEN** two tests run in sequence
- **THEN** the second test starts with no cookies, storage, or navigation history from the first

