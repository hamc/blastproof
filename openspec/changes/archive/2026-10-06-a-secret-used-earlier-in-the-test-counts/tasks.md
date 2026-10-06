# Tasks: a-secret-used-earlier-in-the-test-counts

## 1. The check (design D1, D2)

- [x] 1.1 `judge()` takes an optional `usedEarlier` list of variable names and `secretMismatch` treats them as accounted for. Verify with brain tests: #141's shape with the names passes; the same without them fails as today; #120's shape with `TEST_EMAIL`/`TEST_PASSWORD` listed still fails on `TEST_OTHER`; the names never appear in the prompt
- [x] 1.2 The executor collects the variables used in the actions of finished steps and passes them to both judgments of later steps. Verify with an executor test: a fill of `{{env.X}}` in step 1 reaches step 2's judgment as `X`; a failed action does not count

## 2. The corpus (design D3)

- [x] 2.1 `usedEarlier` is an optional case field, passed through by `runCorpus`. Verify with the corpus tests
- [x] 2.2 #141's case, captured from the demo-app reproduction, verdict PASS, `usedEarlier: ["DEMO_EMAIL", "DEMO_PASSWORD"]`
  - *Reconstructed rather than captured: the run logs keep no judge input, so the snapshot was captured from the demo app after signing in and masked as the executor masks it; the step and earlier fills are the reproduction's*

## 3. Verification

- [x] 3.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 3.2 Mutation check: drop `usedEarlier` from the check; collect names from failed actions too; collect from the current step only. Each must turn a test red
  - *Done.* Ignoring `usedEarlier` in the check, collecting names from the step text instead of what was done, and keeping only the current step each turn one test red
- [x] 3.3 `npm run eval:judge` on the reference pair: no regression, #141's case right
  - *Done 2026-10-06.* Exit 0, 37 cases. #141's case right 3/3 on both models; #120's cases still fail on both; #129's three as before
- [x] 3.4 Live, the demo-app reproduction, 3 runs per model: the last step passes when the agent asserts
  - *Done.* PASS on Haiku 5/5 and Luna 3/3, with no D5 refusal, against 1 of 6 before. One more Haiku run failed with D5 and is excluded: it started about a second before the rebuilt `dist/cli.js` was written (49.1 s ending 14:57:29, build at 14:56:39), so it ran the old code. Three Haiku runs repeated afterwards all passed
- [x] 3.5 Live, Juice Shop `fn-already` and `redact-bad`/`redact-ok` on Luna, 3 runs each: `fn-already` passes when the agent asserts, and `redact-bad` still fails
  - *Done on Luna.* `fn-already`: PASS 3/3 valid runs, no D5, no logout (a fourth started during the rebuild and found no `dist/cli.js`; it was repeated). `redact-bad`: FAIL 3/3 at the right step, the menu showing `[redacted TEST_EMAIL]`. `redact-ok`: PASS 2/3. Its failure is unrelated: in step 5 the agent clicked Log in and answered `fail` at once, with no judgment made, so D5 never ran
- [x] 3.6 Live, the dogfood suite on both models: no regression
  - *Done.* 8 of 8, Score 100, on both models (Haiku 94 calls, Luna 79)
- [x] 3.7 `AGENTS.md`'s judge convention describes the third condition
- [x] 3.8 Archive in the same pull request, as its own commit
