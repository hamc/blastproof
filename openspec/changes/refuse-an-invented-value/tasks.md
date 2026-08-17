# Tasks: refuse-an-invented-value

## 1. The refusal (pure)
- [x] 1.1 In `src/runner/recovery.ts`, give `StepRecovery` a normalised accumulator of the snapshots shown this step (`observe(snapshot)`), per D2/D4 — the masked text, normalised once on the way in.
- [x] 1.2 Extend `refusalFor` (or add a sibling consulted from the same call site) to refuse a `fill`/`select` whose value matches none of the four sources in D3. Placeholder check first, so an `{{env.*}}` value never reaches the string comparison.
- [x] 1.3 The message names the permitted sources and quotes the value, in the voice of the existing refusal: what was not done, why, and what to do instead.
- [x] 1.4 Unit tests in `tests/recovery.test.ts` (or the file that covers `StepRecovery`): value in the step passes; value in an earlier snapshot of the same step passes; value only in the current snapshot passes; `{{env.*}}` passes; a value in none of them is refused; case and whitespace differences pass; `press` and `navigate` are never refused by this rule; a fresh instance does not see the previous step's snapshots.

## 2. Wiring
- [x] 2.1 In `src/runner/executor.ts`, call `recovery.observe(mask(snap))` at the one point the snapshot is taken, before `brain.nextAction` — the same choke point that already masks (D4). Not at a second site.
- [x] 2.2 Feed the step text into the refusal decision (D3 source 2), covering setup steps identically.
- [x] 2.3 Confirm the refusal counts one failed attempt and terminates on the retry budget, exactly as the repeated-commit refusal does (D7). No new counter.
- [x] 2.4 Tests in `tests/executor.test.ts`: a fabricating model is refused, told why, and the step fails when it insists; a model drawing from the step proceeds untouched; an `{{env.*}}` fill still substitutes and succeeds.

## 3. Docs
- [x] 3.1 README: the authoring rule already teaches this; state that it is now enforced at run time and what happens when it is not met.
- [x] 3.2 The reformatting limit (D5) and the short-value limit stated plainly, not discovered by a user. Written into the README beside the rule itself rather than into `docs/`: no page under `docs/` covers the value rule, and a limit stated away from the rule it limits is one nobody reads.
- [x] 3.3 `src/llm/prompts.ts`: the rule stays, but its wording should stop implying the runner merely asks. CHANGELOG is written at release time, not here.

## 4. Verification
- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` green.
- [ ] 4.2 Against `examples/demo-app` with a real model: the reproduction from #57 — a test whose only step is `fill the note field` — is refused rather than passed, and the full shipped suite still scores as it did before. **Both halves are required.** The first proves the defect is closed; the second proves the check does not break the suites this project ships, which is the only measured evidence about false positives.
