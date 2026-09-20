# Spec delta: agentic-execution (say-when-the-page-reformatted-a-secret)

## ADDED Requirements

### Requirement: The mask compares by normalization, not by byte equality
The run-wide mask SHALL redact any occurrence of a registered value that matches it **case-insensitively, with runs of whitespace matched as runs of whitespace** — the same normalization this specification already applies when deciding whether a typed value came from the application. The literal and percent-encoded forms SHALL keep being redacted, so nothing masked today stops being masked.

No further normalization SHALL be applied, and no catalogue of application-side transforms SHALL be maintained. A value the application re-encodes, hashes or truncates produces a string this comparison cannot recognise, and that limit is stated rather than papered over.

The comparison SHALL be a property of the mask itself, so every channel it already covers — the snapshot, the action record, the last result, the step text, the failure reason, the reports — gains it at once, rather than being widened at one call site.

#### Scenario: A value the page uppercased is still redacted
- **WHEN** a test fills a field from `{{env.PROBE_SECRET}}` whose value is `hunter2`, and the application echoes `Unknown promo code "HUNTER2".`
- **THEN** the snapshot crossing into the prompt reads `Unknown promo code "***".`

#### Scenario: Spacing differences do not defeat it
- **WHEN** a registered value contains a space and the page renders it with different whitespace between the same words
- **THEN** the occurrence is redacted

#### Scenario: Every previously masked form stays masked
- **WHEN** a value appears byte-identically, or percent-encoded in a resolved URL
- **THEN** it is redacted exactly as before

#### Scenario: An unrecognisable transform is not claimed
- **WHEN** the application renders a registered value base64-encoded or hashed
- **THEN** the mask does not redact it, and the documentation says this is the boundary

### Requirement: A near-miss is reported once, by variable name
When the mask redacts an occurrence that its literal comparison alone would have missed, the run SHALL report it: the application returned that secret in a form differing from the value supplied, it was redacted, and a form this tool cannot recognise would not have been.

The report SHALL name the `{{env.*}}` variable and SHALL NOT contain the value in any form — neither the value supplied nor the form found on the page. It SHALL appear at most once per variable per run, however many occurrences were redacted. A run in which the widened comparison changed nothing SHALL say nothing, so the signal means what it says.

A near-miss SHALL NOT change the outcome of any step or the exit code: the application's formatting is not a test failure.

#### Scenario: The author is told which variable to look at
- **WHEN** a run redacts an occurrence found only by the widened comparison, for `{{env.PROBE_SECRET}}`
- **THEN** the run reports that `PROBE_SECRET` was returned in a different form, without printing either form of the value

#### Scenario: Silence is the common case
- **WHEN** every redaction in a run was a literal match, or no registered secret appeared on any page
- **THEN** nothing is reported about near-misses

#### Scenario: One line per variable, not one per occurrence
- **WHEN** the same variable's value is redacted by the widened comparison in twenty snapshots across three tests
- **THEN** it is reported once

#### Scenario: A near-miss is not a failure
- **WHEN** a run reports a near-miss and every test passes
- **THEN** the score and the exit code are what they would have been without it
