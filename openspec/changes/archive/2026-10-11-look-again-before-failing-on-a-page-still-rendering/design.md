# Design: look-again-before-failing-on-a-page-still-rendering

## D1. Why `networkidle` does not cover it

`waitForSettled` waits for no network for 500 ms (Playwright's `networkidle`), up to 2 s. An app whose bundle is loaded and whose data is local (IndexedDB, localStorage, an in-browser database) renders with no network at all, so idle arrives first and the snapshot catches a half-built page. Waiting for the DOM instead has no natural end condition, since nothing tells the runner that a page is "done". Waiting longer before every snapshot would tax every step of every run for a case that only matters when the model gives up.

## D2. Only on `fail`, only with nothing done, only once

The trigger is the cheapest place where being wrong is certain to be expensive: the model is about to end the test, and nothing it did can have caused what it sees. "Nothing done" is `recovery.acted`, the same rule that refuses a `done` with nothing done. After an action, the page reflects that action, and a `fail` there is a judgment about it, not about the app's first paint. Once per step bounds the cost: on a page that never stops changing (a clock), the worst case is one extra model call per step.

## D3. Watch for change, not a fixed wait

The executor re-snapshots every 250 ms, for up to 3 s, and stops at the first one that differs from the snapshot the `fail` was decided on. It compares the masked text without refs, because refs are ids and could differ on an unchanged page. A still page, the usual case for a real defect, accepts the `fail` after 3 s with no model call. A changing page goes back to the model immediately, with `lastResult` saying: *"not accepted yet: the page changed after the snapshot you answered fail on — it may still have been loading. Decide again on the page as it is now."* The `fail` and that result are emitted as an action, so the record shows the second look.

3 s was chosen before measuring, as 1.5 times the settle bound. Measured afterwards, the real app paints its start screen 40–270 ms after settle, with the CPU throttled ×1 to ×6, so the window holds an order of magnitude of margin. The window is a constant beside `SETTLE_TIMEOUT_MS`, and it is not configurable until a case shows it needs to be.

## D4. Not a retry

It does not spend `failedAttempts`, since nothing failed. It does spend an iteration, because the model is asked again, and so it stays under `maxIterationsPerStep`.
