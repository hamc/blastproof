## Why

A run has no upper bound. `runCommand` loops over the selected tests, each step spends up to `maxIterationsPerStep` model round-trips, and nothing counts, caps or estimates any of it. The only thing that stops a run is finishing — or the provider refusing.

That is not hypothetical. Measuring the flake rate for #15 exhausted the provider's credit mid-sequence; ten runs then died at the first step with `requires more credits`. The tool spent everything it could and discovered the limit from the outside.

An agent that empties an API key with nothing to interrupt it is an adoption risk out of proportion to the work required to bound it.

## What Changes

- A run carries a **budget**: a maximum number of model calls and a maximum number of tokens. Every model call decrements it.
- A run carries a **deadline**: a maximum wall-clock duration.
- Exceeding either stops the run immediately and reports it as **incomplete**. It is never scored as though it had finished.
- `--dry-run` reports the worst-case model-call count for the selection, so the ceiling is knowable before spending anything.
- New config section and matching CLI flags; absent configuration, behaviour is what it is today (unbounded), so no existing suite changes.

## Capabilities

### New Capabilities

- `run-budget`: bounding a run by model calls, tokens and wall-clock time; the incomplete-run outcome; worst-case estimation before a run.

### Modified Capabilities

- `cli-run-command`: `run` gains budget and deadline flags, a new exit condition, and the estimate in `--dry-run` output.
- `agentic-execution`: model calls are counted and bounded; exhausting the budget ends the run rather than the step.

## Non-goals

- **Not** worker parallelism. Issue #2 bundles it, and it is a change of a different kind — concurrency, browser context lifecycle, interleaved output, deterministic report ordering. It gets its own proposal; #2 stays open for it.
- **Not** a budget denominated in currency. See design D1: a price table per model and provider goes stale silently and would make the cap a guess.
- Not per-test or per-step budgets. The run is the unit that has to be survivable.
- Not retry or backoff behaviour on provider errors.

## Impact

- `src/llm/brain.ts` — the single point every model call passes through; where counting belongs.
- `src/config.ts` — new optional `budget` section.
- `src/commands/run.ts` — seeding the budget, the deadline check between tests, the incomplete outcome, the dry-run estimate.
- `src/cli.ts` — flags and a distinct exit condition.
- `src/report/*` — an incomplete run must be visibly incomplete in both reports.
- No new npm dependency: the AI SDK already returns `usage` on every call and we currently discard it.
