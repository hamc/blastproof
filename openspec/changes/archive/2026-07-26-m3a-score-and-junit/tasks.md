# Tasks: m3a-score-and-junit

## 1. Scoring

- [x] 1.1 `src/report/score.ts` — `WEIGHTS` (P0=3, P1=2, P2=1) and `computeScore(results): number`: rounded weighted pass rate over executed results, 100 when the list is empty (design D1/D2); pure, no I/O
- [x] 1.2 `src/report/score.ts` — `formatScoreLine(score, results, threshold?)`: the summary line, stating "no tests executed" for the empty case and naming the threshold when one is set
- [x] 1.3 Unit tests: all-pass, weighted failure arithmetic (P0 vs P2 asymmetry), empty ⇒ 100, unparseable file counts as a failure, rounding at the boundary

## 2. JUnit report

- [x] 2.1 `src/report/junit.ts` — `escapeXml(text)` covering `& < > " '`, applied at every interpolation point (design D6)
- [x] 2.2 `src/report/junit.ts` — `renderJUnit(results, skipped, { score, durationMs })`: one `testsuite` with `tests`/`failures`/`skipped`/`time`, a `<property name="score">`, one `testcase` per result (`classname` = repo-relative path, `name` = summary, `time` in seconds), `<failure message>` naming the failing step, `<skipped>` cases for unrouted tests (design D7)
- [x] 2.3 `src/report/junit.ts` — `writeJUnit(path, xml)`: creates missing parent directories, returns the written path
- [x] 2.4 Unit tests: suite counts match cases, failure carries reason and step, skipped cases present, score property present, summaries with `& " < >` round-trip and the output parses as well-formed XML

## 3. CLI wiring

- [x] 3.1 `src/commands/run.ts` — compute the score after execution; print it in the summary via `formatScoreLine`; thread `selection.unroutedSkipped` through so skipped cases reach the report
- [x] 3.2 `src/commands/run.ts` — `--min-score` replaces the all-must-pass rule when given (design D4); without it the existing exit-code rule is untouched
- [x] 3.3 `src/commands/run.ts` — `--junit [path]`: default `<sessionDir>/junit.xml`, explicit path honored, parents created, written path echoed; nothing written when the flag is absent
- [x] 3.4 `src/cli.ts` — register `--min-score <n>` (parsed as an integer 0–100, `InvalidArgumentError` otherwise) and `--junit [path]`
- [x] 3.5 Unit tests for `runCommand`: score line present on every run, gate exits 1 below threshold, gate exits 0 tolerating a P2 failure at 85 vs threshold 80, `--min-score 100` stays strict, `--junit` writes to both destinations, no file without the flag, `--min-score 150` exits 2

## 4. Verification

- [x] 4.1 Against `examples/demo-app` with a real provider: a run writes a valid `junit.xml` whose counts and score match the console summary; force a failure and confirm the gate blocks it and tolerates it at a lower threshold
- [x] 4.2 `npm run build && npm run typecheck && npm test` all green

## 5. Docs

- [x] 5.1 README: document `--min-score` (including that it replaces the all-must-pass rule and that `100` is strict) and `--junit`, with a CI-shaped example
- [x] 5.2 `AGENTS.md`: mark M3 partially delivered (m3a done, m3b pending) and add `report/score.ts` + `report/junit.ts` to the architecture block
