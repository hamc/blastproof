## MODIFIED Requirements

### Requirement: The accessibility snapshot cap is configurable
The number of accessibility-tree lines sent to the model SHALL be configurable, defaulting to the current value. Truncation SHALL remain visible in the snapshot so the model is not misled into believing it has seen the whole page: each run of omitted lines SHALL be replaced in place by a line stating how many were omitted and naming `max_snapshot_lines`.

A snapshot over the cap SHALL keep the open dialogs (`dialog`, `alertdialog`), the last one first, and the focused element, each with its subtree and the lines it sits under, before filling the rest of the cap from the top of the page. The kept lines SHALL NOT exceed the cap. A step that fails on a snapshot that was cut SHALL say in its reason that the snapshot was cut at `max_snapshot_lines`.

#### Scenario: Default preserved
- **WHEN** no cap is configured
- **THEN** the snapshot is capped at the established default, exactly as before

#### Scenario: A dense page raises the cap
- **WHEN** an application's pages exceed the default and the cap is raised
- **THEN** more of the accessibility tree reaches the model, bounded by the configured value

#### Scenario: Truncation stays visible
- **WHEN** a snapshot is truncated at whatever cap applies
- **THEN** the snapshot states, where lines were omitted, how many and that `max_snapshot_lines` caused it

#### Scenario: A dialog rendered at the end of a long page survives the cap
- **WHEN** a 670-line snapshot has an open dialog at line 606 and the cap is 200
- **THEN** the dialog and its contents are in the snapshot, and the kept lines do not exceed 200

#### Scenario: A failure on a cut snapshot names the cap
- **WHEN** a step fails and the last snapshot it read was cut
- **THEN** the step's reason says the snapshot was cut at `max_snapshot_lines`
