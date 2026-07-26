# Proposal: m3a-score-and-junit

## Why

blastproof can now decide what to test and write what is missing, but its output is a terminal table — a human has to read it and judge. Nothing a CI can consume, and no way to block a merge. This slice turns the run result into a single number and a machine-readable file, which is what makes the tool gate a pull request instead of merely informing one.

## What Changes

- Add `src/report/score.ts`: priority-weighted score over executed tests (P0=3, P1=2, P2=1), reported as an integer 0–100
- Add `blastproof run --min-score <n>`: exit 1 when the score falls below the threshold, so CI blocks the merge
- Add `src/report/junit.ts` + `blastproof run --junit [path]`: JUnit XML for the run, defaulting to `.blastproof/reports/<session>/junit.xml` when the path is omitted
- Tests skipped as unrouted under `--impacted` are emitted as JUnit `<skipped/>` cases, so the CI report shows the coverage gap instead of hiding it
- The console summary gains the score line, printed on every run whether or not a gate is set

## Capabilities

### New Capabilities

- `scoring`: the priority-weighted score, its definition over an empty selection, and the `--min-score` gate semantics
- `junit-report`: JUnit XML structure, the mapping from test results to cases, and where the file is written

### Modified Capabilities

- `cli-run-command`: new `--min-score` and `--junit` flags, the score line in the summary, and the exit code when the gate fails

## Impact

- New dependencies: **none**. JUnit XML is emitted directly (a handful of well-defined elements); pulling a library for it would fail the AGENTS.md dependency-justification bar
- Affects: `src/report/` (new `score.ts`, `junit.ts`), `src/commands/run.ts` and `src/cli.ts` extended, `tests/`, README
- Test results already carry everything the score and the report need (`priority`, `status`, `durationMs`, `failedStep`, `reason`) and are already secret-masked by the executor

## Non-goals

- No HTML report and no `blastproof test` composite command — both are m3b
- No configurable weights: P0=3 / P1=2 / P2=1 is fixed in this slice
- No coverage penalty in the score: affected-but-uncovered routes stay a report, not a deduction (decided with the user — the score measures what was verified)
- No GitHub Action and no PR comment (M4)
