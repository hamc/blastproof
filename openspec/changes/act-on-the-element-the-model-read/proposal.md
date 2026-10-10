# Proposal: act-on-the-element-the-model-read

## Why

The model reads a snapshot and names an element by role and accessible name. `resolveTarget` then searches the page again for that description and takes the first element that answers to it. Two open issues are that search choosing a different element from the one the model read:

- **#132:** a target with a role and no name resolves to the first element of that role. On the demo app, `{role: button, text: "Checkout"}` clicks "Apply promo code".
- **#60:** a name shared by several elements resolves to the first in document order, silently. Exact names already win over substrings; refusing ambiguity was measured to refuse ordinary navigation.

A wrong click that succeeds yields a verdict about a control nobody targeted, and the report, repeating the target as written, cannot show it.

Playwright 1.62, already a dependency, annotates every element of an `ariaSnapshot({ mode: 'ai' })` with a ref, and `locator('aria-ref=<ref>')` resolves exactly that element. Measured on the demo app:

- A ref whose element was replaced or navigated away from resolves to **nothing**, in about 1 ms. Never another element.
- Refs are stable across snapshots of an unchanged page. A replaced node gets a new ref.
- A plain `ariaSnapshot()` invalidates the refs, so every snapshot must be taken in AI mode.
- The snapshot grows by about 63% in characters, after dropping the `[cursor=pointer]` markers it adds.

## What Changes

- Every snapshot SHALL be taken in AI mode, and the executor's snapshot SHALL show each element's ref.
- A targeted action SHALL name the element by `ref`. It is resolved by that ref alone, with no search, no fallback and no first hit. The schema drops `text`. `role` and `name` stay as the model's statement of what it means.
- The element's role and name SHALL be read from the snapshot line holding that ref. When they disagree with the model's, the action SHALL be refused as a failed attempt naming both. A copied wrong ref cannot click the element next to it.
- A ref that no longer resolves SHALL fail the attempt with "the page changed since the snapshot", not wait out `browser.timeout_ms`.
- The result line, the report and the commit-repeat identity (`contained-recovery`) SHALL use the element's role and name as the snapshot shows them, not the model's words.
- The judge and the planner SHALL receive the snapshot without refs.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: resolution by the ref read; the commit identity is the element's own role and name

## Impact

- `src/runner/snapshot.ts`, `actions.ts`, `executor.ts`, `recovery.ts`, `src/llm/schemas.ts`, `prompts.ts`, `src/auth.ts`, `src/planner.ts`. No new dependencies.
- More tokens per executor call. Measured in verification, against the reliability benchmark's numbers for the default models.

## Non-goals

- **Iframes (#21).** AI-mode snapshots include same-page iframe content, and refs resolve into it, so #21 may move. Guaranteeing it, and `allowed_origins` inside a frame, is its own change.
- **A fallback to role and name when the ref is missing.** It would reopen #60 and #132 for exactly the models that skip the field.
- **Changing the judge's prose.** The judge corpus is replayed unchanged as a check.
