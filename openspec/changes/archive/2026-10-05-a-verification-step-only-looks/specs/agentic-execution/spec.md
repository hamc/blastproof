# Spec delta: agentic-execution (a-verification-step-only-looks)

## ADDED Requirements

### Requirement: A verification step only looks
A step whose first word, after an optional `then` or `and`, is `verify`, `check`, `confirm`, `ensure`, `assert`, `expect` or `validate`, or whose first words are `make sure` or `see that`, SHALL be a verification step. The comparison SHALL ignore case. Only the first word SHALL count: a step that begins with an action and then verifies its outcome is not a verification step.

In a verification step, the executor SHALL refuse a `click`, and a `press` of a key that activates a control, as it refuses any action: it is not performed, the refusal is returned to the model with the reason, and it counts as one failed attempt. `navigate`, `assert` and `fail` SHALL remain allowed. A verification step SHALL close only on a passing judgment: `done` SHALL be refused in it whatever succeeded before.

A step in which no such word is found SHALL be executed as before. The recognition is English only.

#### Scenario: A verification cannot produce what it checks
- **WHEN** a step says "verify the page says "Mechanical Keyboard added to cart."" on a page where nothing was added, and the model clicks "Add to cart"
- **THEN** the click is refused and not performed, and the step fails unless the page shows the message without it

#### Scenario: A verification cannot close on the model's word
- **WHEN** a verification step's model answers `done`
- **THEN** the step is not closed, and the model is told to assert what the page shows

#### Scenario: A verification may navigate to look
- **WHEN** a step says "verify the cart lists "Mechanical Keyboard"" and the model navigates to `/cart`
- **THEN** the navigation is performed and the step is judged on that page

#### Scenario: An action step that verifies its outcome is unchanged
- **WHEN** a step says "click Add to cart and verify the status says "Mechanical Keyboard added to cart.""
- **THEN** the click is performed and the step is judged as before

#### Scenario: A verification that holds still passes
- **WHEN** a step says "verify the total is $96.00" and the page shows it
- **THEN** the assertion passes and the step closes
