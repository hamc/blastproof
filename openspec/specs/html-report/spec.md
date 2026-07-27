# html-report Specification

## Purpose

Explain a run to a human: one self-contained file that opens offline, leads with the score and expands each failure to its step, reason and screenshot.

## Requirements

### Requirement: Self-contained report
The HTML report SHALL be a single file with no external references: CSS inline and failure screenshots embedded as base64 `data:` URIs, so it opens offline and survives being moved or uploaded as a CI artifact.

#### Scenario: Report opens after being moved
- **WHEN** a report is written and then copied to an unrelated directory
- **THEN** it still renders in full, screenshots included

#### Scenario: No external requests
- **WHEN** a report is generated
- **THEN** its markup references no external stylesheet, script, font or image URL

### Requirement: Score and verdict lead the report
The report SHALL open with the run score, the pass and fail counts, and — when a threshold was given — the gate verdict.

#### Scenario: Gate verdict shown
- **WHEN** a run scores 60 against a threshold of 80
- **THEN** the report states the score, the threshold and that the gate failed

#### Scenario: No threshold
- **WHEN** no threshold was given
- **THEN** the score is shown without a gate verdict

### Requirement: Failure detail
Each failed test SHALL show its failing step, the failure reason and its screenshot when one exists; passing tests SHALL be present but collapsed.

#### Scenario: Failure is explained
- **WHEN** a test fails on a step with a reason and a screenshot
- **THEN** the report shows that step, that reason and the image

#### Scenario: Missing screenshot degrades gracefully
- **WHEN** a failed test's screenshot file cannot be read
- **THEN** the report is still produced, noting the screenshot is unavailable

### Requirement: HTML escaping
All interpolated text SHALL be HTML-escaped, covering `&`, `<`, `>`, `"` and `'`.

#### Scenario: Markup in a summary is inert
- **WHEN** a test summary contains `<script>alert(1)</script>`
- **THEN** the report displays it as text and does not execute it

### Requirement: Report destination
The report SHALL be written only when requested: to an explicitly given path, otherwise to `report.html` inside the run's report session directory. Missing parent directories SHALL be created.

#### Scenario: Default destination
- **WHEN** an HTML report is requested without a path
- **THEN** it is written as `report.html` inside `.blastproof/reports/<session>/`

#### Scenario: Not requested
- **WHEN** a run is executed without requesting an HTML report
- **THEN** no HTML file is written
