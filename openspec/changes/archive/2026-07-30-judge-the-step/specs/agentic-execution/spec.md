## MODIFIED Requirements

### Requirement: Supported actions
The executor SHALL support the actions `navigate`, `click`, `fill`, `press`, `select`, `assert`, `done`, and `fail`, mapping them to Playwright operations resolved via `getByRole`/`getByLabel`/`getByText`. Action payloads SHALL have `{{env.*}}` placeholders substituted at the moment the action is performed, and `navigate` SHALL be bounded by the allowed origins.

An `assert` judgment SHALL be made against the **step** being executed, with the model's expectation supplied as the claim offered in support of it. The judgment SHALL pass only when the step's own outcome holds. A claim that is true but does not establish the step's outcome SHALL NOT pass.

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

## ADDED Requirements

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
