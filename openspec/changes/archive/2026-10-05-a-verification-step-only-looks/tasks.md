# Tasks: a-verification-step-only-looks

## 1. The rule (design D1–D3)

- [x] 1.1 `isVerificationStep(step)` in `src/runner/authoring.ts`. Verify with unit tests: every verb in D1, with and without `then`/`and`, any case; "click … and verify …" false; "verification code is shown" false (not the verb); a step in Portuguese false
- [x] 1.2 `StepRecovery.refusalFor` refuses `click` and committing `press` in a verification step, ahead of the other refusals; `navigate`, `fill`, `assert` are not refused by it. Verify with recovery tests
- [x] 1.3 The executor refuses `done` in a verification step whatever succeeded. Verify with executor tests: a click then `done` in a verification step fails; `done` in an action step after a click still closes; an `assert` that passes closes a verification step
- [x] 1.4 Every existing executor, recovery and authoring test passes; update only those that pinned a click inside a step beginning with a verification verb, and say which
  - *Two auth tests used `'check something'` as a placeholder step closed on `done`; renamed to `'open something'`, since what they test is the snapshot cap, not the step. No other test pinned a click inside a verification step*

## 2. Telling the model and the author (design D4)

- [x] 2.1 One sentence in the executor's system prompt. Verify with a prompt test
- [x] 2.2 `skills/blastproof/references/authoring.md`: a row in the enforcement table and the advice to name the action that reveals hidden content. Verify `tests/skill-manifest.test.ts` passes

## 3. Verification

- [x] 3.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 3.2 Mutation check: classify by "contains verify" instead of the first word; drop the refusal; drop the `done` rule. Each must turn a test red
  - *Done.* Matching the verb anywhere turns 13 tests red (existing "submit … and verify …" steps start refusing their own clicks); dropping the refusal turns 3 red; dropping the `done` rule turns 1 red
- [x] 3.3 Live, `examples/demo-app`, both reference models, 3 runs each: VO1 (the added-to-cart message) FAILs every time, with no click performed; VO2 (`/cart`) still FAILs; a variant whose page does show the outcome PASSes
  - *Done 2026-10-05, 3 runs per model.* VO1 FAIL 6/6 (before: PASS 6/6), and no click was performed in any run: Haiku tried twice and was refused, Luna never tried. VO2 FAIL 6/6 as before. VO3, where step 1 clicks and step 2 verifies, PASS 6/6
- [x] 3.4 Live, Juice Shop `fp-basket-count` on Luna, 3 runs: FAIL, and the database basket is unchanged
  - *Done.* FAIL 3/3 (before: PASS 3/3), and the database basket was unchanged every time. Luna's own `fail`: *"this verify-only step cannot modify the basket to reach 7"*
- [x] 3.5 Live, the dogfood suite on both models: no regression
  - *Done.* Both models 8 of 8, Score 100, against a freshly started demo app. Haiku took 95 calls, Luna 78. No step was refused by the new rule
- [x] 3.6 `npm run eval:judge` on the reference pair: no regression (the judge is untouched, so this is a control)
  - *Done.* Exit 0: 33 cases right 3/3 on both models, #129's three 0/3 on Haiku and 3/3 on Luna, as before
- [x] 3.7 Archive in the same pull request, as its own commit
