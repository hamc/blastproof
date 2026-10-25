## Context

`runCommand` prints four warnings to stderr, from four functions, at four moments:

| warning | printer | when |
|---|---|---|
| uncommitted work | `printUncommitted` (`report/uncommitted.ts`) | after the diff, `--impacted` only |
| route drift | `printRouteDrift` (`run.ts`) | after parsing, every path |
| authoring | `printAuthoring` (`run.ts`) | after parsing, every path |
| reformatted secret | `reportNearMissedSecrets` (`run.ts`) | in `finalize`, after the tests |

All four reach `finalize`, which writes both reports, except on two paths that write no report at all: `--dry-run`, and `--fail-on-authoring` firing before any test. Nothing is lost on those: there is no artifact to carry it.

## Goals / Non-Goals

**Goals:**

- Every warning the terminal shows for a run is in that run's JUnit and HTML reports.
- The report and the terminal cannot disagree about what a warning said.

**Non-Goals:**

- Fatal warnings, annotations, `plan`'s warning, renaming (proposal).

## Decisions

### D1. One shape: a warning is its title and its lines, built once

```ts
interface RunWarning {
  kind: 'uncommitted' | 'route-drift' | 'authoring' | 'reformatted-secret';
  title: string;    // the header line the terminal prints
  lines: string[];  // the rest, as printed
}
```

Each printer is split into a pure builder returning a `RunWarning` (or none) and one `emitWarning` that writes it to stderr and appends it to the run's list. The terminal output stays byte-for-byte what it is today, which the existing tests already pin. The reports render the same `title` and `lines`, so there is one text and nothing to keep in sync, the same reason `formatSpendLine` feeds both the console and the HTML report.

The four differ in structure (files, tests, steps, variables) but not in purpose. Giving them one shape answers the issue's "one shape or three?": a report reader needs to know what the run could not vouch for, not a schema per warning.

Alternative rejected: structured fields per kind (`files`, `tests`, `routes`). More to render, more to test, and a second wording of each warning to drift from the first.

### D2. JUnit: a count property and the text in `<system-err>`

`<property name="warnings" value="N"/>`, always present, and when N > 0 a suite-level `<system-err>` after the test cases with each warning's title and lines, separated by a blank line.

A property alone is a number with no content; `route_drift="2"` tells a reader something happened and not what. `<system-err>` holds free text, is in the JUnit schema at suite level, and is shown by the common CI viewers. It is `system-err` rather than `system-out` because that is where the run printed them.

The count is emitted as 0 too, unlike `llm_tokens`, which is omitted when no call reported usage. There, 0 would be a false claim ("spent no tokens"). Here it is a true one: the run printed no warning. It does not mean the suite is clean: the authoring check reads English only, and the docs say so where they list the property.

### D3. HTML: a Warnings section after the score

Between the score card and the test table, one block per warning: the title as a heading, the lines in a preformatted block, so the indentation the terminal uses for files and steps survives. A new `--warn` color token (amber, light and dark) frames it, distinct from the failure red. Absent when there are none, so a clean run's report is unchanged.

After the score rather than before it, because `html-report` requires the score and verdict to lead. Directly after it rather than at the end, because a caveat read after the reader has already believed the number is the terminal's problem again.

All text goes through `escapeHtml`, like everything else the report renders: step text is user-authored.

### D4. No masking is needed, by construction

None of the four carries a secret value. The authoring warning quotes step text from the test file, where a secret is a `{{env.NAME}}` placeholder until action time. The reformatted-secret warning names the variable and never the value, in either form. The uncommitted and drift warnings name files, tests and routes. The reports carry the same text the terminal does, and the terminal (a CI log) is already held to that.

### D5. Collected for the run, passed to `finalize`

`runCommand` holds a `warnings: RunWarning[]` and passes it to `finalize`, which already takes everything the reports need. `reportNearMissedSecrets` runs inside `finalize`, before the reports are written, so its warning joins the list in time. `printUncommitted` stays exported for `plan`, which keeps printing it and has no list to add it to.

## Risks / Trade-offs

- [A report written by a pipeline that treats any `<system-err>` as a failure] → none of the common reporters do; it is the standard home for a suite's stderr.
- [A long authoring list making the HTML report noisy] → it is exactly as long as the terminal's, and a suite that long has a problem worth seeing. Not truncated, because a truncated caveat is the same silence this change removes.
