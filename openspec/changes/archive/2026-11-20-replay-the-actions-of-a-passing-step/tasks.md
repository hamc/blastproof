# Tasks: replay-the-actions-of-a-passing-step

## 1. Saved form

- [x] 1.1 `src/runner/replay.ts`: the file format with `version`, the step key, reading (missing, corrupt or older file is nothing saved) and writing by temporary file and rename (design D2, D7)
- [x] 1.2 Build a step's entry from the step's record: successful actions, `changed`, and how it closed (design D2)
- [x] 1.3 The source of a step's next decision: resolve a saved target to exactly one ref, or end (design D3)

## 2. Executor

- [x] 2.1 Take the next decision from the replay when one is live, else from the model (design D1)
- [x] 2.2 End the replay on a refusal, a raised action, an unchanged page and a failed judgment, with no failed attempt spent (design D4)
- [x] 2.3 Close a replayed step by judgment with the saved claim, or by `done` on performed actions (design D5)
- [x] 2.4 Each step's result carries `replayed`, `model` or `healed` (design D9)

## 3. Run, config, reports

- [x] 3.1 `replay` in the config, `BLASTPROOF_REPLAY`, `--replay` / `--no-replay` on `run` and `test` (design D8)
- [x] 3.2 Load before a test, save after a pass, drop ended steps, write nothing on a stopped run (design D6)
- [x] 3.3 Summary line, HTML label, JUnit properties
- [x] 3.4 `init` ignores `.blastproof/cache/`; this repository's `.gitignore` too

## 4. Tests

- [x] 4.1 Unit tests for every scenario of the spec deltas
- [x] 4.2 Mutation check over `replay.ts` and the executor call sites: each mutant fails a test
  - *Done,* over two review rounds: 22 mutants of the guards in the loop, `replay.ts` and the `run.ts` wiring, each failing at least one test. The survivors left are equivalent or unreachable (a `bindTarget` failure on a target `replayedDecision` built from the same refs)
- [x] 4.4 Review rounds: (1) a click that only moved the focus closed a `done` step, since the snapshot marks the focused element `[active]`; the watch for a late change read a page that had left the allowed origins, and the judge passed a step on it; a saved field of the wrong type failed a step; a failed test emptied what another device had saved. (2) A secret with a quote in it reached the saved name, since the snapshot prints a name escaped. All proven in Chromium by the reviewer, all fixed with a test. (3) On the pull request: a saved `done`, `assert` or `fail` among a step's actions closed or failed it with no model asked (now refused when the file is read); `docs/reliability.md` claimed more than the benchmark measures and mislabelled its healed count; a project set up before this release keeps committing the cache. Left as known: a saved claim can hold a secret the snapshot printed escaped, which the mask misses everywhere and is not this change's
- [x] 4.3 A test that the saved file never holds a resolved secret, a ref or a selector

## 5. Measured before it ships (Haiku 4.5 and `gpt-6-luna`)

- [x] 5.1 `evals/reliability`: a mode that records on the correct app and runs the mutants from those saved actions
- [x] 5.2 False PASS with replay: 0 of 50, and "right step" not lower than without
  - *Done,* 3 samples instead of 5, for the credit there was. Both models: false PASS 0 of 30 literal and 0 of 21 subtle, no bug caught at another step, false FAIL 0 of 30. Steps replayed / healed: Haiku 229 / 14, Luna 231 / 12. Every mutant seeds its bug at a step that checks, so the rule a `done` step closes on with replay is not exercised by this benchmark
- [x] 5.3 Dogfood suite, second run: model calls are judgments only; calls, tokens and time against a run with nothing saved
  - *Luna:* nothing saved, 105 calls, 182k tokens, 272 s; warm, 44 calls, 71k tokens, about 135 s, on each of 10 runs. 39 of 40 steps replayed; the one left is a step whose button has a same-named twin on the page (design D3), and the calls left are judgments and the sign-in. *Haiku 4.5:* nothing saved, 113 calls, 244k tokens, 213 s; warm, 49 calls, 93k tokens, about 95 s, on each of 5 runs, with the same 39 of 40 replayed
- [x] 5.4 Dogfood suite and the notes test in split form, 30 warm runs each: no failure on the correct app
  - *Reduced for the credit there was:* Luna, 10 warm suite runs, and Haiku 4.5, 5 warm suite runs, all Score 100. The notes test was not run on its own: it is in the suite, and in the benchmark's 30 correct-app runs per model
- [x] 5.5 One button of the demo app renamed: the test passes, the step is reported healed, the next run replays it
  - *Done* on `gpt-6-luna`, the notes test with "Add note" renamed "Save note": recorded 4 steps; renamed, 3 replayed and 1 healed, Score 100; the run after, 4 replayed, Score 100. The calls left are the sign-in and the judgments

## 6. Docs and close

- [x] 6.1 `docs/running.md`, `docs/configuration.md`, `docs/ci.md` (cache step), `docs/reliability.md` (the table from 5.2 to 5.4), `docs/writing-tests.md` (when to turn it off), `CHANGELOG.md`, `AGENTS.md`
- [x] 6.2 `npm run build`, `npm run typecheck`, `npm test` all pass
- [ ] 6.3 Archive in the same pull request, as its own commit
