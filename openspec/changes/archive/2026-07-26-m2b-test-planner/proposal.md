# Proposal: m2b-test-planner

## Why

m2a made blastproof sense a PR's blast radius and run only the tests that cover it — but when it finds an affected route no test covers, all it can do is print "affected but uncovered" and stop. Closing that gap by hand is exactly the work users want the agent to do. This slice is M2's WRITE half: turn an uncovered route into a runnable plain-English test.

## What Changes

- Add `src/planner.ts`: for each affected-but-uncovered route, open the route in the browser, capture an accessibility snapshot, and generate a YAML test (`summary`, `steps`, `priority`, `tags`, `routes`) grounded in the elements that actually exist on the page plus the diff context that made the route impacted
- Add `blastproof plan [--base <ref>] [--url <url>] [--route <route>] [--write]`: diff → impact → uncovered routes → generated test drafts
- Preview by default: drafts are printed as YAML to stdout; `--write` persists them under `.blastproof/tests/`
- `--write` never overwrites: a colliding filename is an error naming the existing file, so a review step is impossible to skip
- `--route <route>` (repeatable) generates for explicit routes, bypassing the diff — the way to bootstrap coverage on an existing app
- Generated files carry a comment header recording the route, base ref and generation date, so review sees provenance

## Capabilities

### New Capabilities

- `test-generation`: producing plain-English YAML test drafts for a route from a live accessibility snapshot plus diff context, including the grounding and file-writing rules
- `cli-plan-command`: the `plan` command surface — flag semantics, preview-vs-write behavior, reporting and exit codes

### Modified Capabilities

(none — generated files use the existing `yaml-test-format` schema unchanged, and `run` is untouched)

## Impact

- New dependencies: **none**. Reuses Playwright, the AI SDK `generateObject`/Zod layer (`llm/brain.ts`, `llm/schemas.ts`), `snapshot.ts`, `diff.ts` and `impact.ts` already in the stack
- Affects: `src/` (new `planner.ts`, `commands/plan.ts`; `cli.ts` extended; a new schema in `llm/schemas.ts` and prompts in `llm/prompts.ts`), `tests/`, README
- `AGENTS.md` milestone M2 becomes "done" when this ships (m2a + m2b complete the milestone)

## Non-goals

- No `blastproof test` composite command (diff→plan→run→report) — it only becomes meaningful with M3's score and reports
- No updating or repairing of existing test files; this slice only creates new ones
- No LLM-suggested `routes:` globs for unmapped files — that edits config, not tests, and gets its own slice
- No multi-repo support, no score gating (M3), no GitHub Action (M4)
