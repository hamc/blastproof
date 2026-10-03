# Tasks: identify-a-commit-by-what-resolves-it

## 1. The identity (design D1)

- [x] 1.1 `identity()` uses the action, the role, the name normalized case-insensitively with whitespace collapsed, `text` only when there is neither a role nor a name, and the unresolved value as written. The normalization reuses an existing helper if the codebase has one for this rule, rather than restating it. Verify with `StepRecovery` unit tests: #124's sequence (a click, a fill, the same click with `text` added) refuses the third action; a re-cased, re-spaced name is refused; two text-only targets with different text are both performed; a different name is performed; the same click in a later step is performed
- [x] 1.2 ~~A value's case still distinguishes two fills.~~ Dropped: a fill is never a commit, so it is never refused as a repeat, and the test written for this passed for that reason rather than for the identity. Only `press` carries a value among commits, and key names are exact. See design D1
- [x] 1.3 Every existing `contained-recovery` test passes unchanged

## 2. Verification

- [x] 2.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 2.2 Mutation check: put `text` back unconditionally; drop the name normalization; normalize the value too. Each must turn at least one test red
  - *Done.* `text` unconditional: 2 red. No name normalisation: 1 red. Normalising the value: **0 red**, which exposed that 1.2 tested nothing about the identity (see 1.2 and design D1); the value's handling has no observable effect on refusals today
- [x] 2.3 Executor-level: a scripted brain plays #124's sequence against the fake page, and the page receives exactly one click on "Add note"
- [x] 2.4 Live, the notes test against `examples/demo-app`, 5 runs: no run writes a second note ("Notes on file: 2" never appears). Record how many runs still fail on refused repeats, which is the visible failure the design accepts
  - *Done 2026-10-03.* 5 runs: no second note in any (on `main` the day before, 2 of 5 wrote one); exactly one "Add note" click reached the page in every run; 4 passed, 1 failed on three refused repeats. The log cannot show whether the refused clicks carried `text`, because a refused action is described without it; the mechanism itself is pinned by the unit and executor tests
- [x] 2.5 Live, the dogfood suite: no regression
  - *Done.* 7 of 8, Score 90. The failure is the notes test, on three refused repeats and with no duplicate note: the visible failure design D1 accepts in place of the silent duplicate. The model re-filling a submitted form is what keeps that test unstable, and is separate
