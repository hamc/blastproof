## ADDED Requirements

### Requirement: A replayed step is labelled
With replay on, the HTML report SHALL label each step that was replayed and each step that healed. A step the model resolved with nothing saved SHALL carry no label. With replay off, the report SHALL be unchanged.

#### Scenario: A healed step
- **WHEN** a step's replay ended and the model finished the step
- **THEN** the report shows that step as healed
