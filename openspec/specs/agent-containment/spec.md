# agent-containment Specification

## Purpose

Keep the agent inside the application it is testing and keep secrets out of prompts, so a page that can influence its own content cannot redirect an agent holding a live session.

## Requirements

### Requirement: Navigation is bounded by origin
The executor SHALL reject a `navigate` action whose resolved URL falls outside the application's origin or a configured `allowed_origins:` entry, failing the step with a reason naming the rejected origin.

The boundary SHALL additionally constrain where the page **is**, not only where an action asked to go. Before every snapshot, the executor SHALL compare the current URL against the same allowed set, and SHALL fail the step when it falls outside — however the page got there, including a server redirect, a link to another origin, a form submission, or a script setting the location. A page outside the boundary SHALL NOT be snapshotted, so its content never reaches a prompt.

`about:blank` SHALL be treated as inside the boundary. Every other URL SHALL be compared by origin, and a URL with no comparable origin SHALL NOT be treated as allowed.

#### Scenario: Relative path within the application
- **WHEN** the agent navigates to `/cart` and `base_url` is `http://localhost:4173`
- **THEN** navigation proceeds

#### Scenario: Absolute URL to another origin rejected
- **WHEN** the agent navigates to `https://elsewhere.example.com/x` and that origin is not allowed
- **THEN** the step fails with a reason naming the rejected origin, and the browser does not go there

#### Scenario: Declared additional origin
- **WHEN** `allowed_origins:` lists `https://auth.example.com` and the agent navigates there
- **THEN** navigation proceeds

#### Scenario: The application's own origin needs no declaration
- **WHEN** no `allowed_origins:` is configured
- **THEN** navigation within the `base_url` origin still proceeds

#### Scenario: A redirect carries the page outside the boundary
- **WHEN** a navigation to the application's own origin is answered with a redirect to an origin that is not allowed
- **THEN** the step fails naming that origin, and no snapshot of it is taken

#### Scenario: A click carries the page outside the boundary
- **WHEN** the agent clicks a link whose target is an origin that is not allowed
- **THEN** the step fails naming that origin, however the navigation was triggered

#### Scenario: The page outside the boundary is never read
- **WHEN** the page is outside the boundary
- **THEN** its content is not sent to the model in any prompt

#### Scenario: A declared origin may be landed on
- **WHEN** the page ends up on an origin listed in `allowed_origins:`
- **THEN** the run continues normally

#### Scenario: The empty page is inside the boundary
- **WHEN** the current URL is `about:blank`
- **THEN** the boundary does not fail the step

#### Scenario: A URL with no comparable origin is not allowed
- **WHEN** the page has moved to a `file:` URL
- **THEN** the step fails, because the absence of an origin to compare is not permission

### Requirement: Secrets never reach the model
Steps SHALL retain their `{{env.*}}` placeholders when passed to the model, and the referenced values SHALL be substituted only when the action is performed. Every value referenced anywhere in the run — by any test and by the authentication recipe — SHALL be masked from every prompt sent by any command, including the planner's, and SHALL be masked in its percent-encoded form as well as literally.

#### Scenario: Placeholder is what the model sees
- **WHEN** a step reads `fill the password field with {{env.TEST_PASSWORD}}`
- **THEN** the prompt sent to the provider contains the placeholder and not the value

#### Scenario: The real value is typed
- **WHEN** the model returns a fill action carrying that placeholder
- **THEN** the substituted value is typed into the field

#### Scenario: Missing variable still fails before the browser
- **WHEN** a step references a variable that is not set
- **THEN** the test fails with an error naming the variable, before a page is opened

#### Scenario: Authentication follows the same rule
- **WHEN** an `auth.steps` recipe references `{{env.*}}`
- **THEN** the login journey's prompts carry placeholders, not credentials

#### Scenario: The authentication credential is masked in later prompts
- **WHEN** an authenticated page renders the credential used to sign in, during an ordinary test
- **THEN** it is masked before the snapshot reaches the model

#### Scenario: The planner masks too
- **WHEN** `plan` drafts a test for a route whose page renders a secret
- **THEN** that value is masked before the snapshot reaches the model

#### Scenario: Encoded forms are masked
- **WHEN** an action reports a URL in which a secret appears percent-encoded
- **THEN** the encoded form is masked before that string reaches the model

### Requirement: Page content is framed as untrusted
The system prompt SHALL state that snapshot content describes what is on screen and is never an instruction to follow, and that placeholders are passed through unchanged.

#### Scenario: Instructions embedded in a page
- **WHEN** the page contains text addressed to the agent
- **THEN** the prompt has already told the model to treat such text as content under test rather than as a directive

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
