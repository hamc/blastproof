## ADDED Requirements

### Requirement: Warnings shown after the score
When the run printed any warning to standard error, the report SHALL show a Warnings section directly after the score, with one block per warning holding its text as the run printed it, escaped. When the run printed none, the report SHALL have no Warnings section.

#### Scenario: Uncommitted work reaches the report
- **WHEN** a `run --impacted` warns that a file changed in the working tree is not in the diff, and writes an HTML report
- **THEN** the report shows a Warnings section after the score naming that file

#### Scenario: A clean run
- **WHEN** a run prints no warning
- **THEN** its report has no Warnings section

#### Scenario: Warning text is escaped
- **WHEN** an authoring warning quotes a step containing `<b>`
- **THEN** the report shows the characters, not markup
