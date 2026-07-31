## MODIFIED Requirements

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
