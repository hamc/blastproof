## Context

The action vocabulary is `ACTION_NAMES` in `src/llm/schemas.ts`: `navigate`, `click`, `fill`, `press`, `select`, `assert`, `done`, `fail`. `performResolvedAction` (`src/runner/actions.ts`) maps each targeted action to a Playwright call on the locator `resolveTarget` returns for the action's ref, and `performAction` turns an interception into an obstruction for all of them. `StepRecovery` (`src/runner/recovery.ts`) decides what is a commit (`click`, and a `press` of a key that activates a control): a commit is refused when it repeats, and in a verification step.

## Goals / Non-Goals

**Goals:**

- A step that needs a hover can be carried out.
- Nothing about the existing actions changes.

**Non-Goals:**

- The rest of #22; keeping a hover alive across actions; hovering on the model's behalf (proposal).

## Decisions

### D1. `hover` is a targeted action with no value

`case 'hover'`: `requireTarget`, `resolveTarget`, `locator.hover()`, `ok: hovered <target>`. It is the `click` case with another verb, so it inherits the ref binding (`bindTarget`), the resolution timeout and the obstruction report without new code. A `value` sent with it is ignored, as it is for `click`.

### D2. `hover` is not a commit

A hover changes what the page shows, not what the application holds. So:

- It is not in `COMMIT_ACTIONS`. Repeating it is allowed: a menu that closed is opened again by the same hover, and refusing that would leave the model no way back to it.
- It is allowed in a verification step. "Verify the tooltip on Save says 'Saves the draft'" can only be checked after a hover. The verification rule exists so a check cannot produce what it checks (#139); a hover cannot add to a cart or send a form.
- A successful hover counts as something done (`recovery.acted`), like a `fill`. A step that is only "hover over Products" can close on `done`.

A hover that triggers an application write (a "mark as read on hover") is possible, and the step's own judgment still decides; this is the same position `fill` is in today.

### D3. The prompt names it in one sentence

The system prompt's action line gains: `Use "hover" to point at an element without clicking it, when a menu, tooltip or control appears only on hover.` No other prompt changes. The schema's `target` description lists `hover` with the other targeted actions by omission: it already says null only for navigate, done, fail and an untargeted press.

### Rejected

- **Hover before every click.** Doubles the actions on every page to cover the minority that needs it, and changes what every existing click does.
- **Hover as a `press`-like modifier of `click`.** One action with two meanings is harder to read in the record and the report than two actions.
- **All of #22 in one change.** Each remaining interaction needs its own decisions (where a file comes from, which tab is the page, who answers a `confirm`).

## Risks / Trade-offs

- [The model hovers where a click was meant] → the step's judgment still decides, and a hover changes nothing in the application.
- [A menu closes before the next action reaches it] → the model sees the closed menu in the next snapshot and can hover again; D2 allows the repeat.

## Verification

Unit tests for the schema, the action and the recovery rules. Live: a page whose link appears only on CSS `:hover`, served locally, with a test "hover over the Products menu and click the Keyboards link", on `anthropic/claude-haiku-4.5` and `openai/gpt-6-luna`, 5 runs each. The same test on `main` is expected to fail. The page is a fixture of the check, not part of the demo app, so the reliability benchmark's mutants are unaffected.

Result. 0.30.0, the published release: 0/5 on Haiku and 0/5 on Luna. Both clicked the "Products" link, landed on the products page, and failed the step for want of the Keyboards link. With the change: 5/5 on both, each run `hover link "Products"` then `click link "Keyboards"`.
