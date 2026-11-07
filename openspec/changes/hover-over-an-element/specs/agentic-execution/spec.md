## MODIFIED Requirements

### Requirement: Supported actions
The executor SHALL support the actions `navigate`, `click`, `fill`, `press`, `select`, `hover`, `assert`, `done`, and `fail`, mapping them to Playwright operations on the element the ref of its snapshot line names. Action payloads SHALL have `{{env.*}}` placeholders substituted at the moment the action is performed, and `navigate` SHALL be bounded by the allowed origins.

A `hover` SHALL point at its target without clicking it. It SHALL NOT be a commit: it SHALL NOT be refused as a repeat, and it SHALL be allowed in a verification step.

A `navigate` SHALL report where it landed when the browser ends up at a URL other than the one requested, so that a redirect is visible in the result rather than reported as arrival at the requested URL.

An `assert` judgment SHALL be made against the **step** being executed, with the model's expectation supplied as the claim offered in support of it. The judgment SHALL pass only when the step's own outcome holds. A claim that is true but does not establish the step's outcome SHALL NOT pass.

The value carried by an action SHALL come from the step, from the page, or from an `{{env.*}}` placeholder; a step that needs a value it never gives is a failing step, not a gap for the model to fill. This is enforced by the executor and not merely asked of the model — see "A typed value must come from the test or the application" below for the guarantee and its limits.

#### Scenario: Assert judgment
- **WHEN** the LLM action is `assert` with an expectation
- **THEN** the LLM judges the current snapshot against the step, using the expectation as the claim offered, and returns pass/fail with a reason, which the executor records

#### Scenario: A true but irrelevant claim does not pass
- **WHEN** the step asks that a created record appear in a list, and the model offers a claim about some other element that happens to be present
- **THEN** the judgment fails, because the claim does not establish the step's outcome

#### Scenario: An uncommitted value is not the outcome
- **WHEN** the step asks that something appear in a list, and the value is present only in an unsubmitted form control
- **THEN** the judgment fails, because a value entered is not a value committed

#### Scenario: Assert judgment passes
- **WHEN** an `assert` judgment returns pass
- **THEN** the executor records the result and treats the step as complete

#### Scenario: Assert judgment fails
- **WHEN** an `assert` judgment returns fail
- **THEN** the executor records the result and retries within the per-step retry budget, failing the step when the budget is exhausted

#### Scenario: Placeholder resolved at action time
- **WHEN** a fill action carries `{{env.TEST_PASSWORD}}` as its value
- **THEN** the environment value is substituted immediately before typing

#### Scenario: Navigation outside the allowed origins
- **WHEN** a navigate action resolves to an origin that is neither the application's nor declared
- **THEN** the action fails and the step records the rejection

#### Scenario: A value the step never supplied
- **WHEN** a step requires a field to be filled and names no value for it
- **THEN** a value the model supplies of its own devising is refused rather than typed, so the step fails rather than passing over an input nobody wrote

#### Scenario: A navigation the server redirected
- **WHEN** a navigation ends at a URL other than the one requested
- **THEN** the result names both the requested URL and where the browser landed

#### Scenario: A navigation that goes where it was asked
- **WHEN** a navigation ends at the URL requested
- **THEN** the result is unchanged from before

#### Scenario: A menu that opens on hover
- **WHEN** a link is shown only while the pointer is over a menu, and the model hovers over the menu
- **THEN** the pointer moves onto the menu without clicking it, the result says which element was hovered, and the next snapshot shows the link

#### Scenario: A hover in a verification step
- **WHEN** a verification step needs a tooltip that appears on hover, and the model hovers over its element
- **THEN** the hover is performed, not refused

#### Scenario: A hover repeated
- **WHEN** the model hovers over the same element a second time in a step
- **THEN** the hover is performed, not refused as a repeated commit

### Requirement: An obstructed action is reported as an obstruction, not as a bad target
When an action fails because another element received the pointer event aimed at its target, the executor SHALL report that failure as an obstruction rather than as a resolution failure. The result returned to the model SHALL state that the target was found and is actionable, SHALL name the element that took the event, and SHALL give the ways to clear it: the overlay's own control as it appears in the accessibility snapshot, or a targetless `Escape`. The result SHALL state that retrying the same target under a different name cannot help.

This SHALL apply to every action performed against a resolved element — `click`, `hover`, `fill`, `select`, and a `press` carrying a target — since all of them wait for the same actionability. An error arising from any other cause SHALL reach the model unchanged.

The obstruction SHALL be reported, never cleared by the executor. Dismissing an overlay SHALL remain an action the model chooses and the step records, because an overlay may be the subject of the test rather than an obstacle to it.

The failure SHALL cost one failed attempt against the existing per-step retry budget, exactly as any other action failure does.

#### Scenario: A backdrop over the target is named
- **WHEN** a `click` resolves its target, the element is visible and stable, and a modal backdrop receives the pointer event
- **THEN** the result tells the model the target is fine, names the intercepting element, and offers the overlay's own control or `Escape`

#### Scenario: Re-targeting is named as the move that cannot help
- **WHEN** an action is reported as obstructed
- **THEN** the result says so explicitly, so that choosing a different accessible name for the same target is not the model's reading of the failure

#### Scenario: A fill blocked by an overlay reads the same as a blocked click
- **WHEN** a `fill`, a `select` or a `hover` fails for the same reason
- **THEN** it is translated identically, because the guarantee is over the action path rather than over one action

#### Scenario: An unrelated failure is untouched
- **WHEN** an action fails because the element was never found, or for any reason carrying no interception
- **THEN** the error reaches the model exactly as before

#### Scenario: The obstruction is not cleared for the model
- **WHEN** an action is blocked by a dialog
- **THEN** the executor performs no dismissal of its own, and the page is unchanged except by actions the model chose
