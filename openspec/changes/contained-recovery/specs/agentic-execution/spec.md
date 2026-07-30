## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Supported actions
The executor SHALL support the actions `navigate`, `click`, `fill`, `press`, `select`, `assert`, `done`, and `fail`, mapping them to Playwright operations resolved via `getByRole`/`getByLabel`/`getByText`. Action payloads SHALL have `{{env.*}}` placeholders substituted at the moment the action is performed, and `navigate` SHALL be bounded by the allowed origins.

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
- **WHEN** a navigate action targets an origin that is neither the base URL's nor in the allowed list
- **THEN** the action fails with an explanatory error instead of navigating

#### Scenario: A value the step never supplied
- **WHEN** a step requires a field to be filled and names no value for it
- **THEN** the model does not invent one
