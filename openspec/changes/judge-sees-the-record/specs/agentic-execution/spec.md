## ADDED Requirements

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

## MODIFIED Requirements

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
