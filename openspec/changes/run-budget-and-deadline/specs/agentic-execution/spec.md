## MODIFIED Requirements

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
