# Tasks: no-score-when-nothing-ran

- [x] 1.1 `score.ts`: `scoreOf(results, incomplete)` returning `undefined` for an incomplete run with nothing executed, and the console line for it (design D1, D3)
- [x] 1.2 `run.ts`: `finalize` uses it; `--min-score` is never reached for that run, which already exits 1
- [x] 1.3 `junit.ts`: omit the `score` property when there is no score (design D2)
- [x] 1.4 `html.ts`: no number and no gate verdict when there is no score (design D3)
- [x] 1.5 `action.yml` output description and `docs/ci.md` name the case; CHANGELOG line
- [x] 1.6 Tests for each surface, and the issue's repro (a provider answering 402) run end to end on `examples/demo-app`
  - *Done.* With a fake provider answering 402 and `--min-score 80`, the console says `Score: none (no test executed before the stop)`, the JUnit report has `incomplete` and no `score`, the HTML shows `—` with no gate verdict, the action's grep yields an empty output, and the run exits 1
- [x] 1.7 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 1.8 Archive in the same pull request, as its own commit
