# Spec delta: agentic-execution (refuse-an-invented-value)

## ADDED Requirements

### Requirement: A typed value must come from the test or the application
The executor SHALL NOT perform a `fill` or `select` whose value is traceable to none of: an `{{env.*}}` placeholder, the text of the step being executed, any accessibility snapshot shown to the model during that step, or a value the model already typed successfully in that step. The attempt SHALL be refused rather than performed, the refusal SHALL be returned to the model as that action's result together with the sources it may draw from, and it SHALL count as one failed attempt against the existing per-step retry budget.

Comparison SHALL be made against the **masked** snapshot text — what the model was actually shown — and SHALL be case-insensitive with runs of whitespace collapsed. No further normalization SHALL be applied. A value that is an `{{env.*}}` placeholder SHALL be permitted without any text comparison, since substitution happens after this point and a secret is never compared.

The record of snapshots and typed values SHALL be scoped to the step and reset at every step boundary.

This requirement SHALL apply regardless of the language a step is written in, because it compares text rather than parsing grammar. It does not replace the authoring warning, which predicts the same defect before a run at the cost of being English-only.

`press` and `navigate` SHALL NOT be refused by this rule: a `press` value is a key name rather than free text, and a `navigate` value is already constrained by the trust boundary.

#### Scenario: An invented value is refused
- **WHEN** the step is `fill the note field` and the model proposes a `fill` with a value appearing in neither the step nor any snapshot shown
- **THEN** the fill is not performed, the model is told it was refused and which sources it may use, and one failed attempt is spent

#### Scenario: A value named by the step is performed
- **WHEN** the step is `fill the note field with Check the invoice` and the model fills that value
- **THEN** the fill is performed as before

#### Scenario: A value read from a page earlier in the step is performed
- **WHEN** the model is shown an order number on one page, navigates to another, and types that order number
- **THEN** the fill is performed, because the value appeared in a snapshot shown during this step

#### Scenario: A secret placeholder is never compared
- **WHEN** the model fills a field with `{{env.TEST_PASSWORD}}`
- **THEN** the fill is performed and substitution proceeds, because a placeholder is permitted without text comparison

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
