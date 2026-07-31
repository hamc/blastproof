# agentic-execution Specification

## Purpose

TBD - created by syncing change m1-yaml-runner. Update purpose after archive.
## Requirements
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

### Requirement: Live element resolution
The executor SHALL resolve target elements exclusively from the current accessibility snapshot (role/name/text) on every action attempt and SHALL NOT persist selectors between steps or runs. The configured browser timeout SHALL bound how long resolution waits for a candidate element to become visible, and SHALL bound navigation, so that a slow application is waited for rather than retried at.

#### Scenario: Self-healing after UI change
- **WHEN** an action fails because the target element is not found
- **THEN** the executor retries with a fresh snapshot, allowing the LLM to pick an alternative element, up to the configured per-step retry budget (default 3)

#### Scenario: A slow element is waited for
- **WHEN** the configured browser timeout is 10 seconds and a target element becomes visible after 4 seconds
- **THEN** resolution succeeds without consuming a retry, because waiting is bounded by the configured timeout rather than by a fixed shorter one

#### Scenario: Navigation honours the configured timeout
- **WHEN** a `navigate` action runs against an application configured with a browser timeout
- **THEN** that timeout bounds the navigation, rather than a value fixed in the code

#### Scenario: The timeout is a wait, not a retry
- **WHEN** an element never appears within the configured timeout
- **THEN** the attempt fails and the existing retry budget applies unchanged, so raising the timeout never increases the number of attempts

### Requirement: Supported actions
The executor SHALL support the actions `navigate`, `click`, `fill`, `press`, `select`, `assert`, `done`, and `fail`, mapping them to Playwright operations resolved via `getByRole`/`getByLabel`/`getByText`. Action payloads SHALL have `{{env.*}}` placeholders substituted at the moment the action is performed, and `navigate` SHALL be bounded by the allowed origins.

A `navigate` SHALL report where it landed when the browser ends up at a URL other than the one requested, so that a redirect is visible in the result rather than reported as arrival at the requested URL.

An `assert` judgment SHALL be made against the **step** being executed, with the model's expectation supplied as the claim offered in support of it. The judgment SHALL pass only when the step's own outcome holds. A claim that is true but does not establish the step's outcome SHALL NOT pass.

The value carried by an action SHALL come from the step, from the page, or from an `{{env.*}}` placeholder. The model SHALL NOT be invited to supply a value of its own devising for a field the step does not specify; a step that needs a value it never gives is a failing step, not a gap for the model to fill.

#### Scenario: Assert judgment
- **WHEN** the LLM action is `assert` with an expectation
- **THEN** the LLM judges the current snapshot against the step, using the expectation as the claim offered, and returns pass/fail with a reason, which the executor records

#### Scenario: A true but irrelevant claim does not pass
- **WHEN** the step asks that a created record appear in a list, and the model offers a claim about some other element that happens to be present
- **THEN** the judgment fails, because the claim does not establish the step's outcome

#### Scenario: An uncommitted value is not the outcome
- **WHEN** the step asks that something appear in a list, and the value is present only in an unsubmitted form control
- **THEN** the judgment fails, because a value entered is not a value committed

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

#### Scenario: A value the step never supplied
- **WHEN** a step requires a field to be filled and names no value for it
- **THEN** the model does not invent one

#### Scenario: A navigation the server redirected
- **WHEN** a navigation ends at a URL other than the one requested
- **THEN** the result names both the requested URL and where the browser landed

#### Scenario: A navigation that goes where it was asked
- **WHEN** a navigation ends at the URL requested
- **THEN** the result is unchanged from before

### Requirement: Setup steps and browser lifecycle
The executor SHALL run optional `setup` steps before the test steps, start from the configured `base_url`, and run each test in a fresh browser context.

#### Scenario: Fresh context per test
- **WHEN** two tests run in sequence
- **THEN** the second test starts with no cookies, storage, or navigation history from the first

### Requirement: The accessibility snapshot cap is configurable
The number of accessibility-tree lines sent to the model SHALL be configurable, defaulting to the current value. Truncation SHALL remain visible in the snapshot so the model is not misled into believing it has seen the whole page.

#### Scenario: Default preserved
- **WHEN** no cap is configured
- **THEN** the snapshot is capped at the established default, exactly as before

#### Scenario: A dense page raises the cap
- **WHEN** an application's pages exceed the default and the cap is raised
- **THEN** more of the accessibility tree reaches the model, bounded by the configured value

#### Scenario: Truncation stays visible
- **WHEN** a snapshot is truncated at whatever cap applies
- **THEN** the snapshot states that it was truncated

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

### Requirement: A step's outcome cannot be satisfied by substituting an easier claim
Because the judgment is anchored to the step rather than to whatever the model most recently proposed, a model SHALL NOT be able to close a step whose outcome has not been reached by offering a different claim that happens to hold. Retrying after a failed judgment SHALL continue to be judged against the same step.

#### Scenario: Substitution after a failed judgment
- **WHEN** an expectation fails because the step's outcome has not been reached, and the model then offers an unrelated claim that is true of the page
- **THEN** the judgment still fails, because the step's outcome is what is being decided

#### Scenario: A legitimate second attempt still works
- **WHEN** an expectation fails because the page had not yet reached the state the step describes, and the state is reached on a later attempt
- **THEN** the judgment passes, because the step's outcome now holds

#### Scenario: The expectation remains visible
- **WHEN** any judgment is recorded
- **THEN** the model's expectation and the judge's reason are still reported, so a reader can see what was claimed as well as what was decided

### Requirement: A step does not repeat a commit it already performed
Within a step, the executor SHALL NOT perform an action that commits — a `click`, or a `press` of a key that activates a control — whose action, target and unresolved value match one it has already performed successfully in that same step. The attempt SHALL be refused rather than performed, the refusal SHALL be returned to the model as that action's result together with the reason, and it SHALL count as one failed attempt against the existing per-step retry budget.

The record of successful actions SHALL be scoped to the step and reset at every step boundary. It SHALL hold the unresolved value, so that a `{{env.*}}` placeholder is compared as written and no substituted secret is retained.

This requirement is deliberately about repetition, not about mutation: the executor cannot tell from a role and an accessible name whether an action writes to the application, and does not attempt to. It applies to the whole step and not only to recovery after a failed judgment, because the duplicate commit does not require a judgment to have failed — the trigger is a page that has lost the evidence of what was done to it.

#### Scenario: A commit is not repeated
- **WHEN** the model proposes a `click` identical to one that already succeeded in the same step
- **THEN** the click is not performed, the model is told it was refused and why, and one failed attempt is spent

#### Scenario: A repeat with no failed judgment is still refused
- **WHEN** a step commits, re-fills a field, and proposes the identical commit again, with no assertion between them
- **THEN** the second commit is still refused, because nothing about a failed judgment is required for the duplicate to occur

#### Scenario: Restoring preconditions is still allowed
- **WHEN** the model navigates back to a form, or fills a field again, before proposing the repeated commit
- **THEN** those actions are performed as before, and only the repeated commit is refused

#### Scenario: A key that navigates is not a commit
- **WHEN** a step presses a key that moves focus or dismisses, such as `Tab` or `Escape`, more than once
- **THEN** every press is performed, because only keys that activate a control commit

#### Scenario: A repeat in a later step is unaffected
- **WHEN** a step ends and a subsequent step performs an action identical to one performed earlier in the test
- **THEN** it is performed, because the record is scoped to a single step

#### Scenario: Refusal cannot loop
- **WHEN** the model keeps proposing refused actions
- **THEN** the failed attempts accumulate and the step fails on the existing retry budget

### Requirement: The model recovers with the step's own history in view
The model SHALL receive, on every iteration of a step, the actions already performed successfully in that step together with their results, presented as a record of what it has done and not as instructions. The record SHALL be scoped to the current step, and every value in it SHALL pass through the run-wide mask exactly as the snapshot and the last result already do.

#### Scenario: An action whose evidence the page no longer shows
- **WHEN** an action succeeds and the page that follows it no longer shows that it happened — a submit followed by a redirect back to the same page with the form reset
- **THEN** the model still sees that the action was performed and succeeded, rather than inferring from the page alone that nothing has happened

#### Scenario: The record is masked
- **WHEN** an action carried a value the run has registered as secret
- **THEN** the record shows it redacted, on the same boundary as every other prompt input

#### Scenario: The record does not cross steps
- **WHEN** a new step begins
- **THEN** the record is empty

### Requirement: A judgment is made with the step's record in view
The judge SHALL receive, alongside the step and the model's expectation, the actions already performed successfully in that step together with their results — the same record the model receives, scoped to the step and masked on the same boundary.

The record SHALL be presented as what was done, and SHALL NOT be treated as evidence that the step's outcome holds. An action reported as successful establishes that it was attempted and what it produced; the snapshot remains the only evidence of what is now true.

#### Scenario: An outcome the page can no longer show
- **WHEN** an action succeeds and the page that follows it cannot show that it happened — a navigation the server redirected, a submit answered by a redirect back to a reset form
- **THEN** the judgment is made knowing the action was performed and where it led, rather than inferring from the page alone that it did not happen

#### Scenario: The record does not pass a step on its own
- **WHEN** the record shows a successful action but the snapshot does not show the step's outcome
- **THEN** the judgment still fails, because the record says what was attempted and not what is true

#### Scenario: The record is masked
- **WHEN** an action carried a value the run has registered as secret
- **THEN** the judge sees it redacted, on the same boundary as the snapshot

#### Scenario: The record does not cross steps
- **WHEN** a new step begins
- **THEN** the record the judge receives is empty

#### Scenario: Re-observation sees it too
- **WHEN** a failed judgment is re-evaluated against a freshly settled page
- **THEN** that judgment receives the same record

