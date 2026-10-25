## ADDED Requirements

### Requirement: Warnings carried in the report
The XML SHALL carry every warning the run printed to standard error: a `property` named `warnings` whose value is their count, present on every report including with value 0, and, when there is at least one, a suite-level `system-err` element holding each warning's text as the run printed it. The text SHALL be XML-escaped. Carrying a warning SHALL NOT change the suite's counts, the score or the exit code.

#### Scenario: A drifted route reaches the report
- **WHEN** a run warns that a test declares a route no `routes:` mapping declares, and writes a JUnit report
- **THEN** the XML has a `warnings` property of 1 and a `system-err` naming that test and that route

#### Scenario: A run with no warnings
- **WHEN** a run prints no warning and writes a JUnit report
- **THEN** the XML has a `warnings` property of 0 and no `system-err` element

#### Scenario: The report and the terminal agree
- **WHEN** a run prints an authoring warning and writes a JUnit report
- **THEN** the `system-err` text is the text printed to standard error
