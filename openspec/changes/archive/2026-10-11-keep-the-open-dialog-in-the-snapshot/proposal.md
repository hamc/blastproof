# Proposal: keep-the-open-dialog-in-the-snapshot

## Why

`trimSnapshot` keeps the first `max_snapshot_lines` lines of the accessibility tree and drops the rest (#162). React, Vue and Angular render dialogs, menus and command palettes in a portal at the **end** of `<body>`. So on a long page the cut drops first the element the last action opened, and the step that checks it fails.

Measured on a real budgeting app with demo data:

| page | lines | dialog at line | in today's cut of 200? |
| --- | --- | --- | --- |
| command palette open | 670 | 606 | no |
| help menu open | 343 | 337 | no |
| "add account" modal open | 370 | 339 | no |

With `max_snapshot_lines: 600`, *"press Control+k and verify a "Command Bar" combobox is shown"* failed 3 times in 3, and the judge said why: *"truncated after 600 lines"*. With 1000 it passed. The application worked. Raising the cap is no fix: the docs call it the largest lever on what a run spends, and a user who keeps it low gets wrong verdicts on every dialog of a long page, with nothing in the report naming the cap.

## What Changes

- When a snapshot is over the cap, it SHALL keep, before anything else, the **open dialogs** (`dialog`, `alertdialog`), the last one first, and the **focused element** (`[active]`, which AI-mode snapshots mark), each with its subtree and the lines it sits under. The rest of the budget is filled from the top of the page, as today.
- Each run of dropped lines SHALL be replaced by a marker in place, `- ... (N lines omitted: max_snapshot_lines is 200)`, so the model sees where the page was cut and which setting cut it.
- A step that fails on a snapshot that was cut SHALL say so in its reason, naming `max_snapshot_lines`. A false FAIL caused by the cap then reads as one in the report.
- The cap is still the cap: the kept lines never exceed it. A dialog larger than the cap keeps its first lines.

On the three pages above, a prototype keeps the dialog and focus within 200 lines.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: what a capped snapshot keeps, and a failed step's reason naming the cap.

## Impact

- `src/runner/snapshot.ts` (`trimSnapshot`), `src/runner/executor.ts` (the reason), their tests, `docs/configuration.md`. Snapshots under the cap do not change.
- A snapshot over the cap reaches the model with different lines than today, at the same size.
- The judge corpus does not change: its stored snapshots are not re-cut.

## Non-goals

- **Changing the default cap.**
- **Popovers that are not dialogs and do not hold focus**, such as a tooltip. They are not in the measurement, and a role list grown by guesswork would grow without end.
- **Cutting from the middle without roles.** Cheaper, but a long tail still loses the dialog.
