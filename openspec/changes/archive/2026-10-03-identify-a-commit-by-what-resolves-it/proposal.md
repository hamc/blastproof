# Proposal: identify-a-commit-by-what-resolves-it

## Why

`contained-recovery` refuses a commit already performed in the same step, because a model that sees a form reset by its own submit re-fills it and submits again (#28). The dogfood suite's notes test shows the refusal being bypassed (#124):

```
-> click button "Add note" :: ok: clicked role=button name="Add note"
-> fill textbox "Note" [Check the invoice] :: ok
-> click button "Add note" :: refused: this exact action already succeeded earlier in this step, …
-> click button "Add note" :: ok: clicked role=button name="Add note" text="Add note"
step 4/4: verify the heading shows one note on file
-> assert :: assertion failed: … 'Notes on file: 2' …
```

The second click names the same button and adds `text="Add note"`. `recovery.ts` identifies an action by `action`, `role`, `name`, `text` and `value`, so the two clicks have different identities and a duplicate note is written to the application. On `main`, this test failed 4 of 5 runs in isolation on 2026-10-03, two of them on a duplicate.

The identity includes a field that doesn't decide which element is clicked. `resolveTarget` tries the role, then the accessible name, and falls back to `text` only when those resolve nothing (`actions.ts:186`). Here the role and name resolved the button, so `text` was never read. The same holds for the name's case: resolution falls back to a case-insensitive match, so `"add note"` clicks the same button as `"Add note"` and would slip past too.

## What Changes

- A commit's identity SHALL be what resolution actually uses to choose the element: the action, the role, the accessible name compared case-insensitively with runs of whitespace collapsed, the unresolved value, and `text` **only when the target has neither a role nor a name**.
- Nothing else about the refusal changes: per step, commits only, one failed attempt, the same message.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: the repeated-commit requirement defines when two targets are the same

## Impact

- New dependencies: **none**
- Affects `identity()` in `src/runner/recovery.ts` and its tests
- Fewer duplicate writes. A step that legitimately clicks two buttons whose names differ only in case now loses the second, the cost `contained-recovery` already accepts for a legitimate repeat

## Non-goals

- **Comparing the resolved DOM element.** After a submit a framework may re-render the button as a new element, which would read as a different click, the very case the refusal exists for
- **The re-fill itself.** The model re-filling a submitted field is executor behaviour, and the reason the notes test is unstable. The guard has to hold whatever the model does; why the model does it is separate
- **Names that resolve to the same element without being equal** (`"Add"` matching the `"Add note"` button by substring). Equality after normalization is decidable; "would resolve to the same element" is not, without resolving
