## Why

Tests run one after another. Every external evaluation has said so, and it is the most cited practical complaint about the tool.

Measured on this repository's own suite, just now: **7 tests, 2 minutes 36 seconds, 85 model calls**. Almost all of that time is spent waiting — for a page to settle, for a model to answer — with one browser context open and one request in flight. A pull-request gate that takes two and a half minutes for seven tests does not stay a seven-test suite for long, and the wait is what stops people adding the eighth.

Nothing about the design requires this. `runOne` already opens a fresh browser context per test and closes it afterwards, so tests are already isolated from each other inside the browser. The `for` loop around it is the only thing making them sequential.

## What Changes

- A run can execute several tests at once, bounded by a configured `concurrency:` and a `--concurrency` flag.
- **The default stays 1.** Parallelism is opt-in, because the isolation that matters is not the browser's — it is the application's, and only the person who wrote the tests knows whether theirs can run at the same time.
- With concurrency above 1, each test's output is buffered and printed as one block when it finishes, so a log with several tests in flight stays readable. At 1, output streams exactly as it does today.
- Results are reported in selection order regardless of the order they finish in, so a report never changes shape because of timing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-run-command`: tests may run concurrently, and console output accounts for it.
- `run-budget`: how far a budget can overshoot depends on how many calls can be in flight.

## Non-goals

- **Not parallelising a single test's steps.** A journey is ordered by definition.
- Not a default above 1. See D1: the safe default is the one that cannot silently corrupt someone's run, and the cost of opting in is one line of config.
- Not process-level parallelism or sharding across machines. One browser, several contexts, which is what the existing design already supports.
- Not test-level isolation of the application under test. We cannot provide it and should not pretend to; what we can do is be explicit that it is the user's to reason about.

## Impact

- `src/commands/run.ts` — the sequential loop becomes a bounded pool; `printEvent` becomes a per-test sink.
- `src/config.ts` — `concurrency:`, plus the `--concurrency` flag in `src/cli.ts`.
- `src/runner/budget.ts` — unchanged in behaviour, but its documented overshoot bound now depends on concurrency.
- `README.md` — when parallelism is safe, and when it is not.
- No new npm dependency: a bounded pool is a dozen lines.
