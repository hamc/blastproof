# Design: identify-a-commit-by-what-resolves-it

## Context

**The identity** (`src/runner/recovery.ts`):

```ts
function identity(action: AgentAction): string {
  return JSON.stringify([action.action, action.target?.role ?? '', action.target?.name ?? '',
                         action.target?.text ?? '', action.value ?? '']);
}
```

`contained-recovery` chose it as "`action` + `target.role` + `target.name` + `target.text` + the unresolved `value`", and argued for the unresolved value. It didn't argue for `text`.

**The resolution** (`src/runner/actions.ts`, `resolveTarget`): role with exact name, role with loose name, label exact, label loose, then text exact and text loose, where text is `target.text ?? target.name`. The first candidate that becomes visible wins. So for a target with a role or a name, `text` is read only if none of the earlier strategies finds a visible element. In #124 the role and name found the button, and the `text` the model added was never read. The model is free to add or omit it, because `text` is a schema field described as a fallback.

The loose strategies match the name case-insensitively, so a name the model re-cases resolves to the same element too.

**Where the same normalization already lives.** `agentic-execution` compares a typed value to the page "case-insensitive with runs of whitespace collapsed", and the mask matches secrets the same way since #109. A third copy of that rule is the drift `AGENTS.md` warns about, so this one reuses whichever helper exists, or creates one beside it.

## Goals / Non-Goals

**Goals:** the observed bypass closed, and its case-and-spacing sibling, with nothing else about the refusal changing.

**Non-Goals:** resolving to compare DOM elements, the model's re-fill behaviour, and names related by substring.

## Decisions

### D1: Identify a target by what chooses its element
```
[action, role, normalize(name), role || name ? '' : text, value]
```
- `text` counts only when there is no role and no name, where it is the only thing resolution has.
- `name` is lowercased with whitespace runs collapsed, matching the loose resolution and the codebase's existing normalization.
- `role` is compared as written; ARIA roles are a fixed lowercase vocabulary.
- `value` stays unresolved and as written, as `contained-recovery` decided. In practice this choice changes nothing today: only commits are refused, and the only commit carrying a value is a `press`, whose key names are exact (`Enter`). A mutation that normalised the value turned no test red, which is how this was found; it is kept as written because a value's case is content, and a future commit with free-text value should not inherit a looser rule by accident.

### D2: Not the resolved element
Comparing the element itself would be the most faithful identity, and it fails exactly where the refusal matters: a submit that re-renders the form gives the button a new element, so the repeat would read as a different click. Comparing the selector that resolved it would add an async resolution to the refusal path, which runs before any action. What resolution *would* use is decidable from the target alone, so that's what the identity uses.

## Risks / Trade-offs

- **Over-refusal when the role and name resolve nothing.** If a target's role and name find no element, resolution falls back to `text`, and two such targets differing only in `text` could be different elements. They'd now share an identity, and the second click would be refused. → The model named a role and a name that don't exist on the page, both times. A refused click costs a visible failed step; the alternative keeps the duplicate write this change exists to stop. That's the asymmetry `contained-recovery` already chose.
- **Two buttons whose names differ only in case** are now one target. → The same cost, for the same reason. Real interfaces don't distinguish controls by case.
- **The notes test may still fail.** With the bypass closed, the model's repeated click is refused instead of performed, and a model that keeps proposing it exhausts the retry budget. That turns a silent duplicate row into a visible failed step, which is the guard's purpose. The re-fill behaviour behind it is separate.

## Migration Plan

None.
