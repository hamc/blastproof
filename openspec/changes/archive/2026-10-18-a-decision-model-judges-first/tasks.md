# Tasks: a-decision-model-judges-first

## 1. Configuration

- [x] 1.1 `config.ts`: `first_judge` schema (`model` required, `api_key_env` default `OPENROUTER_API_KEY`, `threshold` in (0, 1) default 0.7), unit tests for absent, defaults, out-of-range threshold, an unknown key warned about (design D1)
- [x] 1.2 `ENV_OVERRIDES`: `BLASTPROOF_FIRST_JUDGE_MODEL`, `BLASTPROOF_FIRST_JUDGE_THRESHOLD`; tests that the model alone turns it on with defaults and that a bad threshold names the variable (spec config-overrides)
- [x] 1.3 Missing key fails before the browser launches, with a `MissingApiKeyError`-standard message naming the variable and the model; test (spec first-judge)

## 2. The client and the choke point

- [x] 2.1 Confirm against a live response the `noul` answer's shape, the usage field names, and `d1-ultra`'s documented context limit; record them in the design's Open Questions (design D3, D6)
  - *Done.* `usage` is `input_tokens`/`output_tokens`, not the names the client first read; fixed, with the tests' fixtures moved to the real shape. The limit is 32,768 tokens, refused with a 422. The shipped client on the live API: p = 0.985 on the orders page, 0.035 with its total transposed
- [x] 2.2 `brain.ts`: `countedGenerate` over a general `counted(budget, call)`; existing budget, timeout, deadline and refusal tests pass unchanged (design D3)
- [x] 2.3 `llm/decision.ts`: the `fetch` client, `APICallError` on an error status or a network failure, two retries with the SDK's backoff, abort across retries; unit tests with a stubbed `fetch` for success, 401, 503-then-success, network error, abort (design D2)
- [x] 2.4 `prompts.ts`: `firstJudgeQuestion()` (instructions + criteria from `evals/judge/jev.ts`); `jev.ts` imports it (design D4)

## 3. The judgment

- [x] 3.1 `judge()` asks the first judge when configured: size bound, threshold, label check over a pass, unreadable answer and below-threshold to the LLM; unit tests for each branch in spec first-judge, including that a label-check failure makes no LLM call and that the input carries labels (design D5, D6)
- [x] 3.2 A pass's reason names the model, the probability and the threshold; the executor's result line shows it; test
- [x] 3.3 `FirstJudgeStats` shared across a run's brains; `first-judge.jsonl` appended per decision call in the session directory; tests that it holds the masked page and no secret value (design D7)
- [x] 3.4 Summary line in `run` (and therefore `test`), and only when configured; test
- [x] 3.5 `estimateMaxModelCalls` and the login ceiling: `N + R + 3·min(N, R)` with a first judge, its comment's derivation extended; tests (design D8, spec run-budget)
- [x] 3.6 Mutation-check: removing the label check over a decision pass, or the threshold comparison, fails a test
  - *Done.* Label check removed: the wrong-secret test fails. `p < threshold` made `p < 0`: the below-threshold test fails. Made `p <= threshold`: the at-threshold test fails

## 4. Measurement

- [x] 4.1 Six number and date mutants on the demo app's orders and cart pages in `evals/reliability/mutants.json`; `tests/reliability.test.ts` passes (design D9)
  - *Done.* As the lab defined them, with its `orders-detail.yaml` in the dogfood suite; every edit applies exactly once
- [x] 4.2 `npm run eval:judge` on the reference pair unchanged (the LLM path is untouched) and `jev.ts` on `liquid/d1-ultra` at 0.7: no false PASS
  - `jev.ts`, `liquid/d1-ultra` at 0.7, 3 samples: 39 of 41 cases right in every sample, no false PASS on 25 FAIL cases, $0.0085. The two misses are #121 PASS cases at p 0.52–0.77, which go to the LLM judge. They are the two #129 cases Haiku 4.5 also misses
  - `eval:judge`, `claude-haiku-4.5` and `gpt-6-luna` through OpenRouter, 3 samples: no regression; the only misses are the two known #129 cases on Haiku
- [x] 4.3 `npm run eval:reliability` with `BLASTPROOF_FIRST_JUDGE_MODEL=liquid/d1-ultra` on Haiku, new mutants included: no false PASS; compare calls with the run without it
  - With the first judge, `claude-haiku-4.5` through OpenRouter, 5 samples: false FAIL 0/45, false PASS 0/50 on literal mutants and 0/30 on subtle ones, the six new mutants included. It passed 498 judgments and sent 394 to the LLM judge
  - Calls, on the two samples both runs completed (the run without it ran out of OpenRouter credit from sample 3, HTTP 402, which stopped those runs as incomplete): on the unmodified suite, 209 calls with it (141 LLM, 68 decision) against 201 without; on the mutants, 950 (659 LLM, 291 decision) against 799. LLM calls fell by 30% and 18%, but total calls rose by 4% and 19%: on a page that should fail, every judgment costs a decision call and an LLM call, and mutants are mostly such pages. The saving is in cost, not calls: on the real app, #174 measured 335 calls against 320, 237 of them LLM calls, for 17% less spent
- [x] 4.4 Live: the budgeting app's suite with the first judge; the summary line and the jsonl match the run
  - Actual 26.10.0, `claude-haiku-5.5` acting, `liquid/d1-ultra` at 0.7, one run: score 95, 331 model calls. Summary `76 passed, 20 to the LLM judge`; the jsonl has 96 lines, 76 `passed` and 20 `to-llm`. 79% passed by the first judge, against 81% in #174. The one failure is the acting model's (a schedule saved with no account, as #174 saw), and its reason is the LLM judge's

## 5. Documentation and wrap-up

- [x] 5.1 `docs/configuration.md`: the section, marked experimental, with what it was measured on, the budget note and the jsonl; `docs/model-evaluations/decision-models.md` says it exists and how to turn it on; CHANGELOG entry
- [x] 5.2 Site article `/notes/jev-as-a-judge`: the byline keeps `published 2026-10-17` and adds `updated <merge date>`; the closing paragraph says the option exists and how to turn it on, and the cost-and-time section explains why the time saved is smaller than the calls saved; the notes index shows the update too. Deployed as a branch preview and approved before the pull request merges; production deploy after the merge
- [x] 5.3 AGENTS.md: config conventions list `first_judge`; one convention paragraph on the first judge
- [x] 5.4 `npm run build`, `npm run typecheck`, `npm test` pass
- [x] 5.5 Archive in the same pull request, as its own commit
