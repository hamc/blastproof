# Tasks: an-action-step-takes-the-next-check

## 1. The join

- [ ] 1.1 `withNextCheck(step, next)` in `authoring.ts`: the joined sentence, or the step unchanged; unit tests for each D1 condition, a trailing period, and the result satisfying `hasVerificationClause`
- [ ] 1.2 The executor gives the joined sentence to `nextAction` and to the judge; events, log and reports keep the written step (design D2); executor tests
- [ ] 1.3 `StepRecovery` keeps the written step as its value source (design D3); a test that a value only the next step names is refused
- [ ] 1.4 The next step still runs and is reported (design D4); `setup` does not join into `steps`

## 2. Live

- [ ] 2.1 The notes test in the split form, 10 runs on Haiku and Luna, against 0.32.0's 0/10 and 6/10
- [ ] 2.2 The dogfood suite once on each model, and `npm run eval:reliability` on both, with no new wrong verdict (design Risks)

## 3. Documentation and wrap-up

- [ ] 3.1 `docs/writing-tests.md`, the `AGENTS.md` bullet on verification steps, the CHANGELOG
- [ ] 3.2 `npm run build`, `npm run typecheck`, `npm test` pass
- [ ] 3.3 Archive in the same pull request, as its own commit
