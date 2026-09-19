# html-report Specification

## Purpose

Explain a run to a human: one self-contained file that opens offline, leads with the score and expands each failure to its step, reason and screenshot.

## Requirements

### Requirement: Self-contained report
The HTML report SHALL be a single file with no external references: CSS inline and, when the run held no secret, failure screenshots embedded as base64 `data:` URIs, so it opens offline and survives being moved or uploaded as a CI artifact.

A run holds a secret when the auth recipe or any test it loaded references an `{{env.*}}` value. Such a run's report SHALL NOT contain any screenshot's image data, whether embedded or inlined in any other form, because nothing can mask pixels and the report is the artifact people share. Everything else about self-containment still applies to it.

The report's closing note SHALL state which of the two it did: that screenshots are embedded, or that they were withheld because the run handled secrets.

#### Scenario: Report opens after being moved
- **WHEN** a run that held no secret writes a report, and the report is then copied to an unrelated directory
- **THEN** it still renders in full, screenshots included

#### Scenario: No external requests
- **WHEN** a report is generated
- **THEN** its markup references no external stylesheet, script, font or image URL

#### Scenario: A run that held a secret embeds no image
- **WHEN** a test that filled a field from `{{env.PROBE_SECRET}}` fails and a screenshot is captured
- **THEN** the report contains no `data:` URI and no bytes of that screenshot

#### Scenario: A secret anywhere in the run withholds every screenshot
- **WHEN** only the auth recipe references `{{env.*}}`, and a test that references none of it fails
- **THEN** that test's screenshot is withheld too

#### Scenario: The closing note matches what was done
- **WHEN** a report withheld its screenshots
- **THEN** it does not claim that screenshots are embedded

### Requirement: Score and verdict lead the report
The report SHALL open with the run score, the pass and fail counts, and — when a threshold was given — the gate verdict.

#### Scenario: Gate verdict shown
- **WHEN** a run scores 60 against a threshold of 80
- **THEN** the report states the score, the threshold and that the gate failed

#### Scenario: No threshold
- **WHEN** no threshold was given
- **THEN** the score is shown without a gate verdict

### Requirement: Failure detail
Each failed test SHALL show its failing step and the failure reason. Passing tests SHALL be present but collapsed.

When a screenshot exists and the run held no secret, the failed test SHALL show the image. When the run held a secret, it SHALL instead state that the screenshot was withheld because the run handled secrets, and give the screenshot's path relative to the report's location, as a link.

#### Scenario: Failure is explained
- **WHEN** a test fails on a step with a reason and a screenshot, in a run that held no secret
- **THEN** the report shows that step, that reason and the image

#### Scenario: Withheld screenshot is located, not lost
- **WHEN** a test fails with a screenshot, in a run that held a secret
- **THEN** the report shows that step and that reason, says the screenshot was withheld because the run handled secrets, and links to the file by a path relative to the report

#### Scenario: Link resolves from a report written elsewhere
- **WHEN** the report is written with an explicit `--html` path outside the session directory
- **THEN** the link is relative to that path and resolves to the screenshot on the machine that ran it

#### Scenario: Missing screenshot degrades gracefully
- **WHEN** a failed test's screenshot file cannot be read, in a run that held no secret
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
