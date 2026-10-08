# Tasks: route-a-gateway-from-the-config

## 1. Implementation (design D1–D3)

- [x] 1.1 `llm.extra_body` in the config schema: an object, refused with `anthropic`. Verify with config tests
- [x] 1.2 `createModel` passes a `fetch` that merges `extra_body` under each JSON body, blastproof's fields winning. Verify with a recording fetch: added key present, `max_tokens` not replaced, non-JSON bodies untouched, no `fetch` override without `extra_body`

## 2. Docs and verification

- [x] 2.1 `docs/configuration.md`: the OpenRouter recipe for open-weight models and why `ignore` is needed beside `require_parameters`
- [x] 2.2 Live: `gpt-oss-20b` through OpenRouter with `extra_body`, through a recording relay that injects nothing. The `provider` object reaches the gateway, and no answer comes from an ignored provider
  - *Done.* A project whose config sets `extra_body.provider` to `{ require_parameters: true, ignore: [Darkbloom, Venice] }` ran the login and consent tests: 2/2 PASS. All 17 requests carried that object and `max_tokens: 4096`. Answers came from Parasail, DeepInfra, AkashML, Novita, CoreWeave and DekaLLM, none from an ignored provider
  - A test with a recording `fetch` fails if `extra_body` is allowed to win over blastproof's fields
- [x] 2.3 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 2.4 Archive in the same pull request, as its own commit
