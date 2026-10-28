## Why

The `--impacted` report uses six words for things that are not covered, not run or not relevant, in one flat list (#39):

```
--- Impact -----------------------------------------------------
Affected routes:
  /cart
  /checkout
Unclassified files (matched by no routes: or ignore: glob):
  src/mystery.ts
Ignored files: 1
Unrouted tests (skipped):
  A test with no routes (.blastproof/tests/loose.yaml)
Affected but uncovered routes:
  /checkout
---------------------------------------------------------------
```

Three lines are about files, two about routes, two about tests, and nothing in the layout says so. The line that means *nobody knows whether this change is covered* sits between two that mean *carry on*. `/checkout` appears twice, under two headings. `Ignored files: 1` names no file. The specs add a seventh word for the same unclassified file, "unmapped", from the flag `--fail-on-unmapped`.

Each word was reasonable when it arrived, which is how they accumulated. Better synonyms would not help: the problem is that there are seven of them, presented as peers, with no single answer to "what is not being tested here?"

## What Changes

- The report is grouped by subject, in the order the pipeline works: changed files, the routes they reach, the tests. Each group says what it found and marks its gap in place, so `/checkout` appears once, with "no selected test covers it" beside it.
- The report opens with one line answering *what is not covered*, counting the three gaps, or saying there are none.
- Two words stay, because they are the config's own: **unclassified** (no `routes:` or `ignore:` glob matches the file) and **ignored** (an `ignore:` glob does). "Affected", "unrouted", "uncovered" and "skipped" leave the report, replaced by what they mean: "routes the diff reaches", "declares no `routes:`", "no selected test covers it".
- The specs say "unclassified" where they said "unmapped". The flag keeps its name.

## Non-goals

- **Renaming `--fail-on-unmapped`.** A flag is an interface people have in their pipelines; renaming it is a breaking change for a word.
- **JUnit.** An unrouted test and a test the budget stopped are both `<skipped/>` there, but with different messages, and `skipped` is the only element JUnit has for a case that did not run.
- **`NOT RUN`** in the run summary. It is a test's outcome, not a coverage gap, and sits in the table of outcomes beside PASS and FAIL.
- **Listing every ignored file.** A docs-only diff can ignore dozens; the report gives the count and the first three.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-run-command`: the impact report's layout and words.
- `impact-mapping`: "unclassified" replaces "unmapped" for a file no glob matches.

## Impact

- `src/commands/run.ts`: `printImpactReport` rewritten; it receives the number of changed files.
- `tests/run.test.ts`: the assertions on the old headings.
- No new dependency. The exit code, the selection and every gate are unchanged.
- Documentation: the README, if it describes the report, and the CHANGELOG.
