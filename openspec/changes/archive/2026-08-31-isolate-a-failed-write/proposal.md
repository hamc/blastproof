# Proposal: isolate-a-failed-write

## Why

`plan --write` contains a *generation* failure and lets a *write* failure end the run (#75). One route that cannot be persisted discards the routes still to come, and no `--- Plan ---` summary prints, so the user is not even told which routes succeeded.

Every draft is a model call against a live page. This is the one loop in the codebase where abandoning early costs money already spent.

The escape is `throw error` in the write branch of `src/commands/plan.ts`, sixty lines after the generation branch does the opposite for the same class of fault.

## What Changes

- The write branch reports the route as failed and continues, whatever the error's kind — the same treatment the generation branch sixty lines above already gives
- Tests covering both: a recognised write failure with routes after it, and an unrecognised one

## Capabilities

### Modified Capabilities

- `test-generation`: per-route isolation covers persistence, not only generation, and does not depend on which error was raised

## Impact

- New dependencies: **none**
- Affects: the write branch of `src/commands/plan.ts` and `tests/plan.test.ts`
- No config surface, no flag, no output format change. A run where every route writes cleanly is byte-identical

## Non-goals

- **No change to what fails.** A collision still refuses to overwrite and still fails its route; this is only about what happens to the routes after it
- **No retry, no partial write, no cleanup.** A route that could not be written stays unwritten
- **Not the readability of the underlying filesystem error** — #75 separates that explicitly, and `writeDraft` already names the path and the remedy
