# Tasks: tell-the-agent-what-its-action-did

## 1. The record

- [x] 1.1 The acting model's record beside `StepRecovery`'s: its successful actions plus each check that failed after re-observation, masked; `nextAction` gets it, `judge` keeps `recovery.stepHistory()` (design D1)
- [x] 1.2 The page-change note after a successful action: none, up to four, more than four changed lines; appended to the record's entry and to `lastResult` (design D2)
- [x] 1.3 Remove the prototype: the `BP83*` switches, the refusal and count variants, the debug lines

## 2. Tests

- [x] 2.1 A failed check appears in the next prompt's record; the judge's record does not have it
- [x] 2.2 The note's three cases, refs ignored, a secret on the page redacted in the note
- [x] 2.3 The record does not cross steps

## 3. Live

- [x] 3.1 The Juice Shop search step on Haiku, 20 runs: better than `main`'s 3/20 (7/20 with the final code)
- [x] 3.2 The same step on `openai/gpt-6-luna`, 10 runs: still 10/10 (measured on the prototype, which this code reproduces)
- [x] 3.3 `npm run eval:reliability` on Haiku: no false FAIL or false PASS beyond `main`'s (measured on the prototype)

## 4. Documentation and wrap-up

- [x] 4.1 The CHANGELOG
- [x] 4.2 `npm run build`, `npm run typecheck`, `npm test` pass
- [x] 4.3 Archive in the same pull request, as its own commit
