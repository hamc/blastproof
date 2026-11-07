# Tasks: show-frames-from-declared-origins

## 1. The cut

- [x] 1.1 `captureSnapshot` takes the boundary; each `iframe` line's frame is resolved from its first child's ref and cut when its origin is not allowed; tests (design D1)
- [x] 1.2 `about:blank`/`srcdoc` take their parent's decision; nested frames cut with their parent; an unresolvable frame is cut; tests (design D2)
- [x] 1.3 `defaultSnapshot` requires the boundary; the executor, the login journey and the planner pass it
- [x] 1.4 A ref inside a cut frame is refused by `bindTarget`; test

## 2. The warning

- [x] 2.1 Cut origins reported to `run` and `plan`, one warning per origin through `emitWarning`; tests (design D3)

## 3. Live

- [x] 3.1 The fixture: the cross-origin frame fails with the warning on Haiku and Luna; with its origin declared, 5/5 on both; the same-origin frame 5/5 on both without a declaration (measured: undeclared cross-origin 0/5 on both with one warning per run, declared 5/5 on both, same-origin 5/5 on both)
- [x] 3.2 The dogfood suite still passes (10/10 on Haiku, score 100)

## 4. Documentation and wrap-up

- [x] 4.1 README (trust boundaries, the unsupported list), `docs/configuration.md`, the CHANGELOG
- [x] 4.2 The site's unsupported list: moved to its own pull request, because `site/` merges only after its preview is approved
- [x] 4.3 `npm run build`, `npm run typecheck`, `npm test` pass
- [x] 4.4 Archive in the same pull request, as its own commit
