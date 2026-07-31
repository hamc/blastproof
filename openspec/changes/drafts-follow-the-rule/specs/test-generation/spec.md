## ADDED Requirements

### Requirement: A generated step states its own outcome
Every generated step SHALL name what should be true once it has been carried out, rather than naming an action alone. A step that supplies a value to the application SHALL write that value, because the executor refuses to invent one.

This is the rule the documentation teaches for hand-written tests, and a draft is also a worked example of it: a step that names an action without an outcome asks the judge to decide whether something happened while looking at the state that succeeding produces, which is the shape behind three separate defects.

Whether a plain-English step states an outcome SHALL NOT be validated mechanically. It is not decidable by a parser, and a heuristic would reject good drafts and accept bad ones silently at generation time. Drafts are printed for review and require an explicit flag to be written; that review is the check.

#### Scenario: An action carries its outcome
- **WHEN** a draft includes a step that submits a form
- **THEN** that step also names what should be true afterwards, rather than naming the submission alone

#### Scenario: A step that fills carries its value
- **WHEN** a draft includes a step that enters text into a field
- **THEN** the step names the value to enter, rather than leaving it for the agent to invent

#### Scenario: Drafts are not rejected mechanically
- **WHEN** a generated step does not obviously state an outcome
- **THEN** generation still succeeds and the draft is printed for review, rather than being refused by a heuristic
