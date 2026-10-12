# Tasks: look-again-before-failing-on-a-page-still-rendering

- [x] 1.1 Executor: on `fail` with nothing done, once per step, watch the page for up to 3 s; accept the `fail` if it did not change, otherwise ask again with the reason in `lastResult` and the second look in the record (design D2–D4)
- [x] 1.2 Unit tests: a page that finishes rendering passes; a still page fails with no extra model call; a `fail` after an action is accepted at once; only once per step
  - *Done*, plus a re-render under new refs is no change. Mutation-checked: each of the three conditions, and the change comparison, has a test that fails without it
- [x] 1.3 Live: a page that renders its button 2 s after load with no network, before and after; the real app's suite at `concurrency: 4`
  - *Done.* Repro page (button rendered 2 s after load, no network), Haiku 5.5: `main` failed 3 of 3 with #14's message ("only a 'Set up sync' link"); this branch passed 3 of 3, each after one second look. The real app paints its start screen 40–270 ms after settle, CPU throttled ×1 to ×6, well inside 3 s. Its 21-test suite at `concurrency: 4`: #14's failure occurred once in the setup of `accounts-create`, was looked at again, and the test passed. 19 of 21 passed; the two failures are the grid-entry tests of #67, as before
- [x] 1.4 `docs/configuration.md` `concurrency` note; CHANGELOG line
- [x] 1.5 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 1.6 Archive in the same pull request, as its own commit
