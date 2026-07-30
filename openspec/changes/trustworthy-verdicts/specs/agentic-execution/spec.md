## MODIFIED Requirements

### Requirement: Per-step agentic loop
The executor SHALL execute each plain-English step via a loop: capture the page accessibility snapshot, ask the LLM for a structured next action, perform the action on the page, and repeat until the step is complete or failed. A step SHALL be complete when the LLM returns `done` **or** when an `assert` judgment passes; the executor SHALL NOT request a further action once either has occurred. Where a run budget is configured, exhausting it SHALL end the run rather than fail the step, so an exhausted budget is never mistaken for a defect in the application under test.

The executor SHALL allow a page navigation in flight to settle before capturing the snapshot it will act or judge on, bounded by the configured browser timeout, so that a verdict describes the page the previous action produced rather than the page it replaced.

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

#### Scenario: A judgment follows a server-side redirect
- **WHEN** an action submits a form that the server answers with a redirect, and the next snapshot would otherwise be captured before that navigation completes
- **THEN** the executor waits for the page to settle first, so the expectation is judged against the destination page rather than the page that was left

#### Scenario: Settling never exceeds the configured timeout
- **WHEN** a page never reaches a settled state
- **THEN** waiting stops at the configured browser timeout and the loop proceeds, so a page that never settles cannot hang the run

## ADDED Requirements

### Requirement: A failed judgment re-observes before the model re-decides
When an `assert` judgment fails, the executor SHALL capture a fresh snapshot and evaluate the same expectation again, at least once, before returning control to the model for a new action. Only after the same expectation has failed against a freshly settled page SHALL the model be asked what to do next.

#### Scenario: A timing artefact resolves on the second look
- **WHEN** an expectation fails against a snapshot taken too early, and the same expectation holds once the page has settled
- **THEN** the second evaluation passes and the step completes, without the model being asked for another action

#### Scenario: A genuine failure still reaches the model
- **WHEN** the same expectation fails against a freshly settled page
- **THEN** the failure stands and the model is asked for the next action, as before

#### Scenario: Re-observation is bounded
- **WHEN** an expectation keeps failing
- **THEN** re-observation is bounded by the retry budget and the step ultimately fails, so re-looking cannot loop indefinitely

### Requirement: A redacted value is described to the model, not left ambiguous
Where the run-wide mask has replaced a value crossing into a prompt, the model SHALL be told what a redaction is: that it stands for a secret deliberately withheld, that seeing one is expected, and that a field showing a redaction after being filled from an `{{env.*}}` placeholder is consistent with the fill having succeeded. A judgment SHALL NOT fail an expectation on the grounds that a value was redacted.

This requirement adds context only. The mask itself is unchanged and remains the boundary: every referenced secret is still redacted from every prompt input.

#### Scenario: A filled credential field is not treated as unverifiable
- **WHEN** a step fills a field from an `{{env.*}}` placeholder and the resulting snapshot shows a redaction where the value would be
- **THEN** the model treats the fill as having succeeded rather than retrying it, and the step advances

#### Scenario: A redaction is not grounds for failing
- **WHEN** an expectation would otherwise be satisfied except that a value in the snapshot is redacted
- **THEN** the judgment does not fail on that basis

#### Scenario: The boundary is unchanged
- **WHEN** any value the run has registered as secret crosses into a prompt
- **THEN** it is still redacted, exactly as before
