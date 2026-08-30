# Spec delta: agentic-execution (name-what-blocks-the-click)

## ADDED Requirements

### Requirement: An obstructed action is reported as an obstruction, not as a bad target
When an action fails because another element received the pointer event aimed at its target, the executor SHALL report that failure as an obstruction rather than as a resolution failure. The result returned to the model SHALL state that the target was found and is actionable, SHALL name the element that took the event, and SHALL give the ways to clear it: the overlay's own control as it appears in the accessibility snapshot, or a targetless `Escape`. The result SHALL state that retrying the same target under a different name cannot help.

This SHALL apply to every action performed against a resolved element — `click`, `fill`, `select`, and a `press` carrying a target — since all of them wait for the same actionability. An error arising from any other cause SHALL reach the model unchanged.

The obstruction SHALL be reported, never cleared by the executor. Dismissing an overlay SHALL remain an action the model chooses and the step records, because an overlay may be the subject of the test rather than an obstacle to it.

The failure SHALL cost one failed attempt against the existing per-step retry budget, exactly as any other action failure does.

#### Scenario: A backdrop over the target is named
- **WHEN** a `click` resolves its target, the element is visible and stable, and a modal backdrop receives the pointer event
- **THEN** the result tells the model the target is fine, names the intercepting element, and offers the overlay's own control or `Escape`

#### Scenario: Re-targeting is named as the move that cannot help
- **WHEN** an action is reported as obstructed
- **THEN** the result says so explicitly, so that choosing a different accessible name for the same target is not the model's reading of the failure

#### Scenario: A fill blocked by an overlay reads the same as a blocked click
- **WHEN** a `fill` or a `select` fails for the same reason
- **THEN** it is translated identically, because the guarantee is over the action path rather than over one action

#### Scenario: An unrelated failure is untouched
- **WHEN** an action fails because the element was never found, or for any reason carrying no interception
- **THEN** the error reaches the model exactly as before

#### Scenario: The obstruction is not cleared for the model
- **WHEN** an action is blocked by a dialog
- **THEN** the executor performs no dismissal of its own, and the page is unchanged except by actions the model chose

## MODIFIED Requirements

### Requirement: Per-step agentic loop
The executor SHALL execute each plain-English step as an agentic loop: capture an accessibility snapshot, ask the LLM for exactly one structured action, perform it, and repeat until the step's outcome holds, the step fails, or the per-step iteration ceiling is reached. A failed action SHALL be returned to the model as the next iteration's previous result and SHALL cost one attempt against the configured per-step retry budget.

The model SHALL be instructed that an action reported as obstructed means an element is on top of its target rather than that the target was chosen wrongly, that what is covering the target appears in the snapshot and is to be dismissed before acting again, and that overlays can be stacked so clearing one may reveal another. This instruction SHALL be stated alongside — not in place of — the existing instruction to choose an alternative element after an error, because the two failures call for opposite moves.

#### Scenario: One action per iteration
- **WHEN** the LLM is asked for the next action
- **THEN** it returns exactly one structured action, never a batch

#### Scenario: A blocked action does not read as a wrong target
- **WHEN** the previous result reports that another element intercepted the pointer event
- **THEN** the model is instructed to locate and dismiss what is covering the target rather than to re-resolve the target under another name
