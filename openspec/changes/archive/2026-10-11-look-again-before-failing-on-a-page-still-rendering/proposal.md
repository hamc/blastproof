# Proposal: look-again-before-failing-on-a-page-still-rendering

## Why

The executor waits for the network to go idle before each snapshot (`waitForSettled`). A single-page app that loads its bundle and then renders from local storage goes idle **before** its first paint is complete. Measured on a real budgeting app (#14): with `concurrency: 4` on a CI runner, a test failed in 5.6 s on its first look at the page.

```
X step failed: The bootstrap page snapshot has no "Try the demo" button, only a "Set up sync" link
```

The start page was still being built. The model answered `fail` on that first snapshot, and the step failed with nothing done. With `concurrency: 1` the same test passed 3 of 3. A failed judgment already looks again before it is believed (`trustworthy-verdicts`). A `fail` from the model does not.

## What Changes

When the model answers `fail` in a step where **nothing has succeeded yet**, the executor SHALL watch the page before accepting it, at most once per step:

- It re-snapshots for up to **3 s**, until the page differs from the snapshot the model failed on (refs aside).
- If the page **did not change**, the `fail` is accepted at once. There is no extra model call, and a real defect on a still page costs at most 3 s.
- If the page **changed**, the `fail` is not accepted. The model is asked again on the new page, and told that its `fail` was decided on a page still changing. The record shows this, so a report reader sees the second look.

`docs/configuration.md`'s `concurrency` section SHALL say that a slower, shared machine turns marginal render timing into failures, and that this second look covers the first paint only.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: a `fail` with nothing done is checked against a page that may still be rendering.

## Impact

- `src/runner/executor.ts` and its tests, `docs/configuration.md`, CHANGELOG.
- On a still page, the cost is ≤ 3 s per such failure and no tokens. On a changing page, it is one model call per step at most.
- Cannot create a false PASS: it never acts on the page and never closes a step. It only lets the model decide on a newer page.

## Non-goals

- **The config-driven recovery guidance** in #14's original proposal ("if a busy banner shows, wait and retry"). It needs a measured case that this does not cover. #14 stays open for it.
- **A `fail` after something was done.** By then the page reflects the step's own actions, and the existing paths (failed-judgment re-observation, retries) apply.
- **Marking a test that passed after a second look as different in the score.** The record shows it, and the score does not change.
