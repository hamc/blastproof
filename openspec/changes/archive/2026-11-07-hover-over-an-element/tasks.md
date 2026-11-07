# Tasks: hover-over-an-element

## 1. The action

- [x] 1.1 `hover` in `ACTION_NAMES` and the parsed schema; a schema test (design D1)
- [x] 1.2 The `hover` case in `performResolvedAction`; tests for the result, the ref binding and an intercepted hover reported as an obstruction (design D1)
- [x] 1.3 Not a commit: a repeated hover and a hover in a verification step are performed; a hover counts as done work (design D2)
- [x] 1.4 The system prompt's action line (design D3)

## 2. Live

- [x] 2.1 A local page with a CSS hover-only menu: "hover over the Products menu and click the Keyboards link" fails on `main` and passes with the change, 5 runs each on Haiku and Luna (0.30.0: 0/5 on both; with the change: 5/5 on both)

## 3. Documentation and wrap-up

- [x] 3.1 README (hover leaves the unsupported list), the CHANGELOG
- [x] 3.2 `npm run build`, `npm run typecheck`, `npm test` pass
- [x] 3.3 Archive in the same pull request, as its own commit
