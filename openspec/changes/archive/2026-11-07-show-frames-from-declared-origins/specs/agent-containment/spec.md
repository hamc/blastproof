## ADDED Requirements

### Requirement: Frame content is bounded by origin
A frame's content SHALL reach a prompt only when the frame's origin is the application's or one `allowed_origins:` declares, compared as navigation is. The content of any other frame SHALL be replaced in the snapshot by one line saying it is not shown and why, under the frame's own line, so that none of its elements has a ref an action can name. A frame without an origin of its own (`about:blank`, `srcdoc`) SHALL take the decision of the frame containing it, a frame inside a frame not shown SHALL NOT be shown, and a frame whose origin cannot be determined SHALL NOT be shown.

The rule SHALL hold for every snapshot, whichever reader it is taken for: the executor, the login journey and the planner.

For each origin whose frame content was not shown, the run SHALL print one warning naming the origin and the `allowed_origins:` entry that would show it, and the reports SHALL carry it.

#### Scenario: A frame on the application's origin
- **WHEN** a page under test has a frame on `base_url`'s origin
- **THEN** its content is in the snapshot, with refs the model can act on, and no declaration is needed

#### Scenario: A frame on an undeclared origin
- **WHEN** a page under test has a frame from an origin neither the application's nor declared
- **THEN** the snapshot shows the frame's line and, under it, only a line saying its content is not shown and naming the origin

#### Scenario: An action on an element of a frame not shown
- **WHEN** the model names a ref from inside a frame whose content was not shown
- **THEN** the action is refused as naming an element the snapshot does not have, and nothing in the frame is acted on

#### Scenario: A declared frame origin
- **WHEN** `allowed_origins:` lists the frame's origin
- **THEN** the frame's content is in the snapshot and can be acted on

#### Scenario: A declared frame inside an undeclared one
- **WHEN** a frame from a declared origin is inside a frame from an undeclared one
- **THEN** neither frame's content is shown

#### Scenario: A srcdoc frame
- **WHEN** a frame has no origin of its own
- **THEN** it is shown exactly when the frame containing it is

#### Scenario: The warning names the origin once
- **WHEN** content from one undeclared origin was left out of several snapshots in a run
- **THEN** the run prints one warning naming that origin and the `allowed_origins:` entry, and the reports carry it
