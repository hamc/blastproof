# Spec delta: agentic-execution (judge-the-place-the-step-names)

## ADDED Requirements

### Requirement: A value counts only in the place the step names
When a step names where its outcome must appear (in the confirmation, in a list, in the cart, for one order), that place SHALL be part of the outcome the judgment decides. A value shown only somewhere else on the page SHALL NOT satisfy the step, whatever the model's claim calls that other place. A step that names no place SHALL be judged as before.

#### Scenario: The value is mentioned elsewhere
- **WHEN** a step verifies order number `#BP-1001` in the confirmation message, and the confirmation shows `#BP-1002` while another paragraph mentions `#BP-1001` as a previous order
- **THEN** the step fails

#### Scenario: The claim renames the other place
- **WHEN** the same page is judged with a claim that calls the previous-order paragraph "the confirmation message"
- **THEN** the step still fails, because the claim does not decide which element the step names

#### Scenario: Another value elsewhere does not hurt
- **WHEN** the confirmation shows `#BP-1001` and another paragraph mentions `#BP-0998` as a previous order
- **THEN** the step passes
