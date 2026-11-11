# Tasks: an-action-step-takes-the-next-check

## 1. The judged step

- [x] 1.1 `withNextCheck(step, next)` in `authoring.ts`: the judged sentence, or the step unchanged; unit tests for each D1 condition, trailing punctuation, a check starting with `and`/`then`, an upper-case check, and the result satisfying `hasVerificationClause`
- [x] 1.2 The executor gives the judged sentence to every judgment and the written step to the acting model, events, log and reports (design D2, D4); executor tests, including that no `nextAction` input names the check
- [x] 1.3 `StepRecovery` closes on the judged sentence and keeps the written step as its value source, `{{env.*}}` names included (design D4); tests for a value and a placeholder only the check names
- [x] 1.4 The judgment before failing: only after an action succeeded, only within the allowed origins, one judgment, a pass closes the step (design D3); tests for each condition
- [x] 1.5 The next step still runs and is reported; `setup` does not join into `steps`

## 2. Live

- [x] 2.1 The notes test in the split form, 10 runs on Haiku and Luna, against 0.32.0's 0/10 and 6/10
- [x] 2.2 The false check, 5 runs on each model: it fails, and "Add to cart" is never clicked
- [x] 2.3a The dry-run ceiling counts the judgment before failing; a mutant failing at the step judged on its declared step is scored caught (`reliability-benchmark` delta); the mutant `menu-cart-goes-home`
- [x] 2.3 `npm run eval:reliability` on both models with no new wrong verdict (2 samples, the 14 mutants on tests with a qualifying step)

## 3. Documentation and wrap-up

- [x] 3.1 `docs/writing-tests.md`, `README.md`, the `AGENTS.md` bullet on verification steps, the CHANGELOG
- [x] 3.2 `npm run build`, `npm run typecheck`, `npm test` pass
- [x] 3.3 Archive in the same pull request, as its own commit
