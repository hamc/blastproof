# Spec delta: agentic-execution (name-what-blocks-the-click)

## ADDED Requirements

### Requirement: An obstructed action is reported as an obstruction, not as a bad target
When an action fails because another element received the pointer event aimed at its target, the executor SHALL report that failure as an obstruction rather than as a resolution failure. The result returned to the model SHALL state that the target was found and is actionable, SHALL name the element that took the event, and SHALL give the ways to clear it: the overlay's own control as it appears in the accessibility snapshot, or a targetless `Escape`. The result SHALL state that retrying the same target under a different name cannot help.

This SHALL apply to every action performed against a resolved element — `click`, `fill`, `select`, and a `press` carrying a target — since all of them wait for the same actionability. An error arising from any other cause SHALL reach the model unchanged.

The obstruction SHALL be reported, never cleared by the executor. Dismissing an overlay SHALL remain an action the model chooses and the step records, because an overlay may be the subject of the test rather than an obstacle to it.

The failure SHALL cost one failed attempt against the existing per-step retry budget, exactly as any other action failure does.

#### Scenario: A backdrop over the target is named
- **WHEN** a `click` resolves its target, the element is visible and stable, and a modal backdrop receives the pointer event
- **THEN** the result tells the model the target is fine, names the intercepting element, and offers the overlay's own control or `Escape`

#### Scenario: Re-targeting is named as the move that cannot help
- **WHEN** an action is reported as obstructed
- **THEN** the result says so explicitly, so that choosing a different accessible name for the same target is not the model's reading of the failure

#### Scenario: A fill blocked by an overlay reads the same as a blocked click
- **WHEN** a `fill` or a `select` fails for the same reason
- **THEN** it is translated identically, because the guarantee is over the action path rather than over one action

#### Scenario: An unrelated failure is untouched
- **WHEN** an action fails because the element was never found, or for any reason carrying no interception
- **THEN** the error reaches the model exactly as before

#### Scenario: The obstruction is not cleared for the model
- **WHEN** an action is blocked by a dialog
- **THEN** the executor performs no dismissal of its own, and the page is unchanged except by actions the model chose

## MODIFIED Requirements

### Requirement: Per-step agentic loop
The executor SHALL execute each plain-English step via a loop: capture the page accessibility snapshot, ask the LLM for a structured next action, perform the action on the page, and repeat until the step is complete or failed. A step SHALL be complete when the LLM returns `done` **or** when an `assert` judgment passes; the executor SHALL NOT request a further action once either has occurred. Where a run budget is configured, exhausting it SHALL end the run rather than fail the step, so an exhausted budget is never mistaken for a defect in the application under test.

The executor SHALL allow a page navigation in flight to settle before capturing the snapshot it will act or judge on, bounded by the configured browser timeout, so that a verdict describes the page the previous action produced rather than the page it replaced.

The model SHALL be instructed that an action reported as obstructed means an element is on top of its target rather than that the target was chosen wrongly, that what is covering the target appears in the snapshot and is to be dismissed before acting again, and that overlays can be stacked so clearing one may reveal another. This instruction SHALL be stated alongside — not in place of — the existing instruction to choose an alternative element after an error, because the two failures call for opposite moves.

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

#### Scenario: A blocked action does not read as a wrong target
- **WHEN** the previous result reports that another element intercepted the pointer event
- **THEN** the model is instructed to locate and dismiss what is covering the target rather than to re-resolve the target under another name
