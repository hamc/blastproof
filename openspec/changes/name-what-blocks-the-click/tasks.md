# Tasks: name-what-blocks-the-click

## 1. The translation
- [x] 1.1 In `src/runner/actions.ts`, recognise Playwright's interception line and capture the element that took the event, truncated (D2).
- [x] 1.2 Build the obstruction message: the target is fine, this is what took the click, here are the two exits, re-targeting will not help (D3).
- [x] 1.3 Guard the whole of `performAction` rather than the four locator call sites (D1). Any error carrying no interception passes through unchanged.

## 2. The rule
- [x] 2.1 One rule in `agentSystemPrompt()`, beside the existing "choose an alternative element" rule rather than replacing it (D4). It names the stacking case.

## 3. Tests
- [x] 3.1 Pin the message against a real Playwright timeout string, call log included (Risks: this is the coupling, and it must fail loudly).
- [x] 3.2 `fill` and `select` blocked the same way are translated identically (D1).
- [x] 3.3 An `Element not found` and a generic failure reach the caller unchanged.
- [x] 3.4 Executor-level: an obstructed action costs one failed attempt and the message reaches the next prompt as `lastResult`.
- [x] 3.5 The prompt states the rule, in `containment.test.ts`'s style of asserting on prompt content.

## 4. Verification
- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` green — 552 tests, 33 files.

  **The new tests are load-bearing, confirmed by mutation.** With `obstructionFor`'s
  match forced to `null` — the translation off, every other line unchanged — six of
  them fail: all five message assertions in `tests/actions.test.ts` and the executor's
  `reaches the next prompt as an obstruction naming the blocker`. The three that stay
  green with the mutation are the ones that should: two assert the untouched path (an
  unrelated failure reaches the caller as the same object, an unresolvable target still
  reads as `Element not found`), and the executor's budget/dismissal tests assert
  behaviour rather than wording.
- [ ] 4.2 Live, against an application that stacks overlays on first load: the run gets past the first screen, and the dismissal appears in the step record as an action the model chose.
