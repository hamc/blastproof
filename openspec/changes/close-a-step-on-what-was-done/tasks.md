# Tasks: close-a-step-on-what-was-done

## 1. The predicate

- [ ] 1.1 `StepRecovery` gains a read-only accessor over the history it already keeps — "did anything succeed this step" (design D1)
- [ ] 1.2 Unit test: it is false before any `record()`, true after one, and unaffected by `observe()` — a snapshot is not an action

## 2. The refusal

- [ ] 2.1 The `done` branch refuses when nothing succeeded: not performed, reason returned to the model, one failed attempt spent (design D2)
- [ ] 2.2 The message instructs rather than complains — a step whose outcome already holds is closed by asserting that it holds, not by declaring completion (design D3)
- [ ] 2.3 The refusal carries no page text, only the rule, matching the other refusals in this loop

## 3. Tests

- [ ] 3.1 #76's reproduction: a step whose target does not exist fails rather than passes, and the message names the step
- [ ] 3.2 A step that acted and then answers `done` still closes — the ordinary path is untouched
- [ ] 3.3 A step that answers `done` after a *failed* action is refused: `record()` is only reached on success (design D4)
- [ ] 3.4 A model that answers `done` repeatedly terminates on the retry budget, not on the iteration ceiling (design D2)
- [ ] 3.5 A step that asserts the outcome instead of declaring it closes normally — the escape hatch D3 depends on actually works
- [ ] 3.6 A setup step is held to the same rule (design D5)
- [ ] 3.7 Mutation: allow `done` with nothing recorded again and confirm 3.1 is the test that goes red

## 4. Verification

- [ ] 4.1 `npm run build`, `npm run typecheck`, `npm test`
- [ ] 4.2 Live against `examples/demo-app`: the full suite still passes with no extra failures. This is the risk this change carries — a step that was closing on a bare `done` will now need a round trip or will fail
- [ ] 4.3 Live against a real application (Juice Shop), including a step written in the defensive shape the design flags — "dismiss any cookie banner if present" — to see what the refusal does to it
