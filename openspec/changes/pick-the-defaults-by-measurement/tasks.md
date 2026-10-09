# Tasks: pick-the-defaults-by-measurement

## 1. Implementation (design D1, D4)

- [x] 1.1 `DEFAULT_MODELS`: `openai` → `gpt-6-luna`, `ollama` → `gpt-oss:20b`, with a comment naming the docs table. Verify with `tests/provider.test.ts`
- [x] 1.2 `init` template comment lists the new defaults

## 2. Docs (design D2, D3)

- [x] 2.1 `docs/configuration.md`: provider table, Ollama example, and a "Choosing a model" section with the table, date, reproduce command, the `gpt-oss-20b` false PASS, and `qwen3.6-35b-a3b` as the larger alternative
- [x] 2.2 `README.md`: one sentence after the reliability table linking to it

## 3. Verification

- [x] 3.1 `gpt-6-luna` through the `openai` provider, model omitted, live: the request names `gpt-6-luna` and the API knows the id
  - *Done, short of a run.* `GET /v1/models/gpt-6-luna` on the OpenAI API answers with the model. `blastproof run` with `provider: openai` and no `model` printed `model=gpt-6-luna` and reached the API, which refused for quota (HTTP 429 `insufficient_quota`), not for an unknown model. The suite's verdicts on this model are the benchmark's, through OpenRouter
- [x] 3.2 `npm run build`, `npm run typecheck`, `npm test` all pass
- [ ] 3.3 Archive in the same pull request, as its own commit
