## Context

`printImpactReport` (`src/commands/run.ts`) prints five flat sections from `ImpactResult` (affected routes, unmapped files, ignored files) and `ImpactedSelection` (unrouted skipped tests, uncovered routes). It runs on `run --impacted` with and without `--dry-run`, and through `test`, which calls `run`. `plan` prints no impact report.

## Goals / Non-Goals

**Goals:**

- One question, "what is not covered?", answered in one line before the detail.
- Each subject (files, routes, tests) once, with its gap marked in place.

**Non-Goals:**

- The flag's name, JUnit, `NOT RUN`, a full list of ignored files (proposal).

## Decisions

### D1. The layout

```
--- Impact against main ----------------------------------------
Not covered: 1 unclassified file · 1 route no selected test covers · 1 test with no routes:

Changed files: 4
  2 reach a route
  1 ignored by an ignore: glob: docs/notes.md
  1 unclassified, matched by no routes: or ignore: glob:
      src/mystery.ts
Routes the diff reaches: 2
  /cart
  /checkout  (no selected test covers it)
Tests: 1 selected
  1 declares no routes:, so --impacted cannot select it:
      A test with no routes (.blastproof/tests/loose.yaml)
----------------------------------------------------------------
```

With no gap the first line reads `Not covered: nothing`. A count line under a group appears only when it is not zero, so a clean diff reads as three short lines.

The order is the pipeline's: a diff becomes files, files become routes, routes select tests. A reader looking for why a test did not run follows the same arrows the tool did.

The opening line exists because the issue's last question has an answer: if one line could stay, it would be the one saying what is not covered. It counts the same three things the groups mark, in the same words, so it cannot say something the detail does not.

The base ref goes in the header, since every line below is relative to it and the old report never said which.

### D2. Two words stay, because the config uses them

**ignored** is what an `ignore:` glob does, and **unclassified** is the absence of both kinds of glob; a reader who knows the config already knows them. The rest are replaced by phrases that say what they mean, in the config's terms:

| was | now |
|---|---|
| affected routes | routes the diff reaches |
| unmapped (specs) | unclassified |
| unrouted (skipped) | declares no `routes:` |
| affected but uncovered | no selected test covers it |

"Selected" is kept in "no selected test covers it" on purpose: with `--tag` or `--priority`, a route can have a test that the filters left out, and "no test covers it" would then be false.

### D3. Ignored files: the count and the first three

They are deliberately irrelevant, so they are not the reader's problem, but `Ignored files: 1` gave no way to check that the right file was ignored. The first three names, then `and N more`, let someone check a surprising count without a docs-only diff printing a page of Markdown files.

### D4. Specs say "unclassified"

`impact-mapping` reported the same file as "unmapped" and classified it as "unclassified" in adjacent requirements. Its requirements now say "unclassified" throughout. The flag `--fail-on-unmapped` keeps its name (proposal non-goal), and its error message already says "match no routes: or ignore: glob".

## Risks / Trade-offs

- [A script greps the old headings] → the report is for people; machine output is the exit code and the JUnit report, per the guardrail on CLI output. The CHANGELOG names the change.
- [Seven words become five plus phrases] → the gain is not fewer words but one per subject, and the opening line, which is the one a skimming reader keeps.
