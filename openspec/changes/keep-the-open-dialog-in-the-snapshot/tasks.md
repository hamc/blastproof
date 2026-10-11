# Tasks: keep-the-open-dialog-in-the-snapshot

- [x] 1.1 `trimSnapshot`: anchors (design D1) and in-place markers (design D2); unit tests with a portal-shaped fixture, a nested dialog, an `[active]` outside a dialog, a dialog larger than the cap, a single-quoted dialog line, and a page under the cap left unchanged
  - *Done.* Mutation-checked: with no anchors, five tests fail; with every dialog taken before focus, the focus-before-an-earlier-dialog test fails
- [x] 1.2 Executor: a failed step whose last snapshot was cut names `max_snapshot_lines` in its reason (design D3)
- [x] 1.3 `docs/configuration.md`: what a cut keeps; CHANGELOG line
- [x] 1.4 Live: Actual Budget's command-bar test with `max_snapshot_lines` at the default, before and after
  - *Done.* Both command-bar tests, `max_snapshot_lines` unset (200), 2 runs each: `main` failed 4 of 4, every judgment saying the snapshot was truncated; this branch passed 4 of 4
- [x] 1.5 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 1.6 Archive in the same pull request, as its own commit
