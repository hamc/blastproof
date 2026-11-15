# Tasks: replay-the-actions-of-a-passing-step

## 1. Saved form

- [ ] 1.1 `src/runner/replay.ts`: the file format with `version`, the step key, reading (missing, corrupt or older file is nothing saved) and writing by temporary file and rename (design D2, D7)
- [ ] 1.2 Build a step's entry from the step's record: successful actions, `changed`, and how it closed (design D2)
- [ ] 1.3 The source of a step's next decision: resolve a saved target to exactly one ref, or end (design D3)

## 2. Executor

- [ ] 2.1 Take the next decision from the replay when one is live, else from the model (design D1)
- [ ] 2.2 End the replay on a refusal, a raised action, an unchanged page and a failed judgment, with no failed attempt spent (design D4)
- [ ] 2.3 Close a replayed step by judgment with the saved claim, or by `done` on performed actions (design D5)
- [ ] 2.4 Each step's result carries `replayed`, `model` or `healed` (design D9)

## 3. Run, config, reports

- [ ] 3.1 `replay` in the config, `BLASTPROOF_REPLAY`, `--replay` / `--no-replay` on `run` and `test` (design D8)
- [ ] 3.2 Load before a test, save after a pass, drop ended steps, write nothing on a stopped run (design D6)
- [ ] 3.3 Summary line, HTML label, JUnit properties
- [ ] 3.4 `init` ignores `.blastproof/cache/`; this repository's `.gitignore` too

## 4. Tests

- [ ] 4.1 Unit tests for every scenario of the spec deltas
- [ ] 4.2 Mutation check over `replay.ts` and the executor call sites: each mutant fails a test
- [ ] 4.3 A test that the saved file never holds a resolved secret, a ref or a selector

## 5. Measured before it ships (Haiku 4.5 and `gpt-6-luna`)

- [ ] 5.1 `evals/reliability`: a mode that records on the correct app and runs the mutants from those saved actions
- [ ] 5.2 False PASS with replay: 0 of 50, and "right step" not lower than without
- [ ] 5.3 Dogfood suite, second run: model calls are judgments only; calls, tokens and time against a run with nothing saved
- [ ] 5.4 Dogfood suite and the notes test in split form, 30 warm runs each: no failure on the correct app
- [ ] 5.5 One button of the demo app renamed: the test passes, the step is reported healed, the next run replays it

## 6. Docs and close

- [ ] 6.1 `docs/running.md`, `docs/configuration.md`, `docs/ci.md` (cache step), `docs/reliability.md` (the table from 5.2 to 5.4), `docs/writing-tests.md` (when to turn it off), `CHANGELOG.md`, `AGENTS.md`
- [ ] 6.2 `npm run build`, `npm run typecheck`, `npm test` all pass
- [ ] 6.3 Archive in the same pull request, as its own commit
