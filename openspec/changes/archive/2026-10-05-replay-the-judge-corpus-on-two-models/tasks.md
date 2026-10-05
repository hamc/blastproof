# Tasks: replay-the-judge-corpus-on-two-models

## 1. The replay (design D1, D3, D4)

- [x] 1.1 `runCorpus` catches a non-`RunStoppedError` from the judge and scores the sample wrong, with `error: <message>` as its reason; a `RunStoppedError` propagates. Verify with tests using a stub judge that throws each kind
- [x] 1.2 Results are per model; regressions are wrong on any model, now-passing is right on every model. Verify with tests on two stub judges: an unmarked case wrong on one; a marked case right on one and wrong on the other
- [x] 1.3 `run.ts` reads `EVAL_MODELS`, building one brain per model from the resolved `llm` with `model` replaced, and reports per case and per model. Without it, behaviour is unchanged. Verify with a test on the parsing, and by running both forms
  - *The parsing lives in `evals/judge/models.ts`, because `run.ts` replays as soon as it is imported*

## 2. The policy (design D2)

- [x] 2.1 `CONTRIBUTING.md` "Changing how a verdict is reached" gives the two-model command and asks a judge change to pass on both
- [x] 2.2 `AGENTS.md`'s judge-corpus convention names the reference pair and why

## 3. Verification

- [x] 3.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 3.2 Live: `EVAL_MODELS=anthropic/claude-haiku-4.5,openai/gpt-6-luna npm run eval:judge`. Exit 0; #129's cases reported wrong on Haiku and right on Luna, and not as now passing
  - *Done 2026-10-05.* Exit 0. 33 cases were right 3/3 on both models. #129's three cases were 0/3 on Haiku and 3/3 on Luna, and they were shown as `xfail` with Haiku's reason, not as now passing
- [x] 3.3 Live: the same with `xiaomi/mimo-v2.6-flash` added. The replay finishes and scores its unusable answers
  - *Done with MiMo alone, which tests the same thing for a third of the cost.* The replay finished: 35 cases right, and one sample in `121-already-dismissed-run4-11` scored wrong as `error: No object generated: response did not match schema.` That case is reported as a regression on `xiaomi/mimo-v2.6-flash`, exit 1. Before this change, `npm run eval:judge` crashed on MiMo's first unusable answer
- [x] 3.4 Archive in the same pull request, as its own commit
