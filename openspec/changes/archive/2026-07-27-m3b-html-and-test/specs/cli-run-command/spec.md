# Spec delta: cli-run-command (m3b-html-and-test)

## ADDED Requirements

### Requirement: HTML flag
The `run` command SHALL support `--html [path]`, writing a self-contained HTML report to `path` when given, or to `report.html` inside the report session directory when the flag is used without a value.

#### Scenario: Report written to an explicit path
- **WHEN** the user runs `blastproof run --html build/report.html`
- **THEN** the HTML report is written to `build/report.html` and the path is reported on the console

#### Scenario: Both reports at once
- **WHEN** the user runs `blastproof run --junit junit.xml --html report.html`
- **THEN** both files are written and both paths are reported
