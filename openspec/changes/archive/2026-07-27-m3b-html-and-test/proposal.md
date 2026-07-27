# Proposal: m3b-html-and-test

## Why

Two gaps close the M3 milestone. A failed run currently leaves a console table and a PNG path on disk — enough for a machine, not enough for a human deciding whether a failure is real. And `blastproof test`, the one-shot command the README has advertised since day one, does not exist: the diff-driven pipeline still has to be assembled by hand from `plan` and `run --impacted`.

## What Changes

- Add `src/report/html.ts` + `run --html [path]`: a single self-contained HTML file with the score, per-test results, per-step detail and failure screenshots embedded inline — one artifact to upload, openable offline
- Add `blastproof test [--base <ref>]`: diff → impacted tests execute → drafts generated for affected routes no test covers → report and score gate
- Generated drafts are **reported, never executed**: the gate depends only on tests a human approved
- `test` composes the existing flags: `--url`, `--min-score`, `--junit`, `--html`, `--write`
- Add `CONTRIBUTING.md`: the spec-driven workflow is not guessable from the tree, and a contributor who misses it opens a pull request that cannot be merged as-is

## Capabilities

### New Capabilities

- `html-report`: the report's structure, self-containment, escaping and destination
- `cli-test-command`: the `test` pipeline — what it runs, what it only reports, and how it gates

### Modified Capabilities

- `cli-run-command`: new `--html` flag

## Impact

- New dependencies: **none**. Screenshots are embedded as base64 data URIs read from the paths the executor already writes
- Affects: `src/report/` (new `html.ts`), `src/commands/` (new `test.ts`), `src/cli.ts`, `tests/`, README, `AGENTS.md`, new `CONTRIBUTING.md`
- Completes milestone M3

## Non-goals

- Executing generated drafts: it would let unreviewed, model-written tests block a merge, contradicting the review-first decision taken in m2b
- No trend history, no cross-run comparison, no JavaScript interactivity beyond collapsing sections
- No PR comments or GitHub Action (M4)
