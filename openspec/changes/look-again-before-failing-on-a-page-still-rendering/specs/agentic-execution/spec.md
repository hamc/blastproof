## ADDED Requirements

### Requirement: A fail with nothing done is checked against a page still rendering
When the model answers `fail` in a step in which no action has yet succeeded, the executor SHALL, at most once per step, watch the page for a bounded time before accepting it. If the page, refs aside, differs from the snapshot the `fail` was decided on, the `fail` SHALL NOT be accepted: the model SHALL be asked again on the current page and told why, and the record SHALL show the second look. If the page does not change within the bound, the `fail` SHALL be accepted without another model call.

#### Scenario: A page still rendering is looked at again
- **WHEN** the model answers `fail` on the first snapshot of a step because a button is not there yet, and the button appears a second later with no network activity
- **THEN** the model is asked again on the page with the button, and the record shows the `fail` was not accepted because the page changed

#### Scenario: A still page fails as before
- **WHEN** the model answers `fail` with nothing done, and the page does not change
- **THEN** the step fails with the model's reason, and no further model call is made for it

#### Scenario: A fail after an action is accepted at once
- **WHEN** the model answers `fail` after an action in the step succeeded
- **THEN** the step fails without watching the page

#### Scenario: Only once per step
- **WHEN** the model answers `fail` again after its first `fail` was not accepted
- **THEN** the second `fail` is accepted without watching the page
