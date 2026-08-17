# Spec delta: agentic-execution (env-placeholder-must-be-named)

## MODIFIED Requirements

### Requirement: A typed value must come from the test or the application
The executor SHALL NOT perform a `fill` or `select` whose value is traceable to none of: an `{{env.*}}` placeholder the step being executed references, the text of that step, any accessibility snapshot shown to the model during that step, or a value the model already typed successfully in that step. The attempt SHALL be refused rather than performed, the refusal SHALL be returned to the model as that action's result together with the sources it may draw from, and it SHALL count as one failed attempt against the existing per-step retry budget.

A value SHALL be refused when it references any `{{env.*}}` variable the step does not reference, whatever else the value contains. Variable names SHALL be compared exactly, without case folding, since two names differing only by case are two different variables. What counts as a referenced variable SHALL be decided by the same rule that governs substitution and masking, so that a value cannot be substituted under one definition of a placeholder and admitted under another.

A value referencing only variables the step names SHALL be admitted without any text comparison, since substitution happens after this point and a masked value could match neither the step nor the page.

Comparison of all other values SHALL be made against the **masked** snapshot text — what the model was actually shown — and SHALL be case-insensitive with runs of whitespace collapsed. No further normalization SHALL be applied.

The record of snapshots and typed values SHALL be scoped to the step and reset at every step boundary. The set of referenced variables SHALL be taken from the step being executed alone, not from other steps of the test or of the run.

This requirement SHALL apply regardless of the language a step is written in, because it compares text rather than parsing grammar. It does not replace the authoring warning, which predicts the same defect before a run at the cost of being English-only.

`press` and `navigate` SHALL NOT be refused by this rule: a `press` value is a key name rather than free text, and a `navigate` value is already constrained by the trust boundary.

#### Scenario: An invented value is refused
- **WHEN** the step is `fill the note field` and the model proposes a `fill` with a value appearing in neither the step nor any snapshot shown
- **THEN** the fill is not performed, the model is told it was refused and which sources it may use, and one failed attempt is spent

#### Scenario: A placeholder the step never named is refused
- **WHEN** the step is `fill the Password field`, naming no variable, and the model proposes `{{env.ACTUAL_PASSWORD}}`
- **THEN** the fill is refused, because a variable the step does not reference is one the test never pointed at that field

#### Scenario: A placeholder the step named is performed
- **WHEN** the step is `fill the Password field with {{env.TEST_PASSWORD}}` and the model proposes that placeholder
- **THEN** the fill is performed and substitution proceeds, without any text comparison

#### Scenario: A substituted value is always a masked value
- **WHEN** a value is admitted because the step references its variables
- **THEN** those variables were registered for masking from that same step text, so no substituted value can reach a prompt or a report unredacted

#### Scenario: Variable names are compared exactly
- **WHEN** the step references `{{env.TOKEN}}` and the model proposes `{{env.token}}`
- **THEN** the fill is refused, because they name different variables

#### Scenario: A value embedding a placeholder is judged by the same rule
- **WHEN** a value contains a placeholder alongside other text, such as `Bearer {{env.TOKEN}}`
- **THEN** its variables are subject to the same requirement as a value that is only a placeholder

#### Scenario: A value read from a page earlier in the step is performed
- **WHEN** the model is shown an order number on one page, navigates to another, and types that order number
- **THEN** the fill is performed, because the value appeared in a snapshot shown during this step

#### Scenario: Case and spacing differences are not inventions
- **WHEN** the step names `Order not received` and the model types `order not  received`
- **THEN** the fill is performed

#### Scenario: A value the model already typed may be typed again
- **WHEN** a submit is answered by a redirect that empties the form, and the model re-types the value it used earlier in the step
- **THEN** the fill is performed, because that value passed this check when it was first typed

#### Scenario: The record does not cross steps
- **WHEN** a later step types a value that appeared only in an earlier step's snapshot
- **THEN** it is refused, because the record is scoped to a single step

#### Scenario: Refusal cannot loop
- **WHEN** the model keeps proposing values it cannot source
- **THEN** the failed attempts accumulate and the step fails on the existing retry budget
