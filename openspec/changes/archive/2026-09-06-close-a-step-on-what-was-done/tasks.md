# Tasks: close-a-step-on-what-was-done

## 1. The predicate

- [x] 1.1 `StepRecovery` gains a read-only accessor over the history it already keeps — "did anything succeed this step" (design D1)
- [x] 1.2 Unit test: it is false before any `record()`, true after one, and unaffected by `observe()` — a snapshot is not an action

## 2. The refusal

- [x] 2.1 The `done` branch refuses when nothing succeeded: not performed, reason returned to the model, one failed attempt spent (design D2)
- [x] 2.2 The message instructs rather than complains — a step whose outcome already holds is closed by asserting that it holds, not by declaring completion (design D3)
- [x] 2.3 The refusal carries no page text, only the rule, matching the other refusals in this loop

## 3. Tests

- [x] 3.1 #76's reproduction: a step whose target does not exist fails rather than passes, and the message names the step
- [x] 3.2 A step that acted and then answers `done` still closes — the ordinary path is untouched
- [x] 3.3 A step that answers `done` after a *failed* action is refused: `record()` is only reached on success (design D4)
- [x] 3.4 A model that answers `done` repeatedly terminates on the retry budget, not on the iteration ceiling (design D2)
- [x] 3.5 A step that asserts the outcome instead of declaring it closes normally — the escape hatch D3 depends on actually works
- [x] 3.6 A setup step is held to the same rule (design D5)
- [x] 3.7 Mutation: allowed `done` with nothing recorded again — **5 tests go red**, all of them in the new block, and nothing else in the suite moves

## 4. Verification

- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` — 579 passed, 34 files
- [x] 4.2 Live against `examples/demo-app`, real browser, `claude-haiku-4.5`: **8 passed, 0 failed, Score 100, 93 model calls** — the same call count as before the change. One earlier attempt failed the notes test at `Notes on file: 3`; that was a demo server left running all day accumulating state, confirmed by restarting it and re-running the test alone (PASS, `Notes on file: 1`), not by assuming
- [x] 4.3 Live against OWASP Juice Shop with the defensive shape the design flags, written twice in a row so the second occurrence has nothing left to close: **PASS**. On the empty occurrence the model asserted that nothing was covering the page and the judge agreed — it reached for evidence over declaration without being refused first, which is D3's escape hatch working before it is needed

## 5. What the live runs did NOT show

- [x] 5.1 **The refusal never fired in any live run.** Across four probes — the demo-app suite, the defensive shape, and #76's reproduction twice — `claude-haiku-4.5` never answered a bare `done`; faced with an impossible step it asserted instead, and failed on the assertion budget. The unit tests and the mutation are what prove the rule; the live runs prove it does not disturb the ordinary path
- [x] 5.2 #76's reproduction, re-run: against a control the application genuinely lacks anywhere, the step **fails with Score 0**. The outcome the issue asks for is confirmed live, by a different route than the one this change adds
- [x] 5.3 First attempt at that reproduction used #76's own wording — "the promo code field" — and **passed for a legitimate reason**: the model navigated to the cart page and filled the promo code field that exists there. The probe was rewritten against a control that exists nowhere. Recorded because the first result looks like a failed fix and is not one
