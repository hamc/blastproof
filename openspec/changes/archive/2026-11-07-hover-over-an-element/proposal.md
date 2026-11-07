## Why

The agent cannot hover. A navigation menu that opens only on hover, a tooltip, a row's actions that appear on hover: everything behind one is out of reach, and a step describing it has no action that can express it, so the model substitutes a click (which may navigate away or do something else) or fails the step (#22). The README lists hover among what is not supported.

Hover is the first row of #22's table, the most common of the missing interactions, and the smallest: Playwright's `locator.hover()` acts on an element the same way `click()` does, waits for the same actionability, and can be intercepted the same way. The rest of #22 (scroll, upload, tabs, dialogs, drag and drop) each raises its own question and stays there.

## What Changes

- A new action, `hover`, with a target and no value: the executor resolves the target by its ref, like every targeted action, and calls `locator.hover()`. The result is `ok: hovered <role> "<name>"`.
- `hover` is not a commit. It is never refused as a repeat, and it is allowed in a verification step, where it can reveal what the step checks (a tooltip) without changing anything in the application.
- An intercepted hover is reported as an obstruction, through the path `click`, `fill`, `select` and `press` already share.
- The agent's system prompt names it in the line that describes each action.
- The README stops listing hover as unsupported.

## Non-goals

- **The rest of #22.** Scroll, upload, tabs, native dialogs and drag and drop are separate decisions.
- **Keeping the hover alive.** The mouse stays where `hover()` left it until the next action moves it. A menu that closes when the mouse leaves for its item is the application's behaviour, and the next `click` on that item is Playwright's own straight-line move.
- **A hover the model does on its own.** The model chooses `hover` like any other action; nothing in the runner hovers before a click.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agentic-execution`: `hover` joins the supported actions.

## Impact

- `src/llm/schemas.ts`: `hover` in `ACTION_NAMES`; the `target` description already covers it (design D3).
- `src/runner/actions.ts`: the `hover` case.
- `src/llm/prompts.ts`: one sentence in the system prompt's action line.
- `tests/`: schema, action, recovery (not a commit, allowed in a verification step) and obstruction tests.
- `README.md`, `CHANGELOG.md`, `AGENTS.md` (the architecture line for `actions.ts`). The site's "Not supported yet" list changes with the release, since `site/` deploys by hand.
- No new dependency.
