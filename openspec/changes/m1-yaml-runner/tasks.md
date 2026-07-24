# Tasks: m1-yaml-runner

## 1. Project setup

- [ ] 1.1 Install dependencies: `commander yaml zod ai @ai-sdk/anthropic @ai-sdk/openai playwright`; dev: `tsup vitest typescript @types/node tsx @types/yaml`
- [ ] 1.2 Configure `tsup` (ESM bundle, `src/cli.ts` entry, shebang banner) and `vitest`

## 2. Config & test format

- [ ] 2.1 `src/config.ts` — Zod schema + loader for `.blastproof/config.yaml` (defaults, actionable errors)
- [ ] 2.2 `src/runner/testfile.ts` — YAML test file parser/validator (summary, steps, priority, tags, setup)
- [ ] 2.3 `src/runner/env.ts` — `{{env.VAR}}` substitution + `maskSecrets` utility
- [ ] 2.4 Unit tests for 2.1–2.3

## 3. LLM layer

- [ ] 3.1 `src/llm/provider.ts` — factory: anthropic | openai | ollama (OpenAI-compatible baseURL), default models, fail-fast on missing key
- [ ] 3.2 `src/llm/schemas.ts` — Zod schema for agent action (`navigate|click|fill|press|select|assert|done|fail`, target, value, reasoning, expectation)
- [ ] 3.3 `src/llm/prompts.ts` — system prompt + per-iteration user prompt (step, snapshot, last action result)
- [ ] 3.4 Unit tests with mocked model

## 4. Runner

- [ ] 4.1 `src/runner/snapshot.ts` — `ariaSnapshot()` capture + trimming
- [ ] 4.2 `src/runner/actions.ts` — action→Playwright mapping with `getByRole`/`getByLabel`/`getByText` fallback chain
- [ ] 4.3 `src/runner/executor.ts` — per-step loop (retry budget, fresh context per test, screenshots on failure under `.blastproof/reports/<session>/`)
- [ ] 4.4 Unit tests for executor loop with mocked LLM + mocked page

## 5. CLI

- [ ] 5.1 `src/cli.ts` — commander wiring: `init`, `run` (+ `--tag`, `--priority`, `--query`), exit codes 0/1/2
- [ ] 5.2 `src/commands/init.ts` — scaffold `.blastproof/` (idempotent, next-step guidance)
- [ ] 5.3 `src/commands/run.ts` — discovery, filters, sequential execution, console summary table

## 6. Demo app & E2E validation

- [ ] 6.1 `examples/demo-app/` — static pages: home, login (env-user/password), cart with promo-code discount
- [ ] 6.2 `.blastproof/` sample tests targeting the demo app (created by `init`)
- [ ] 6.3 Manual E2E: `init` → `run` against demo app with a real provider; verify pass and forced-failure paths (screenshot + exit 1)

## 7. Verify & docs

- [ ] 7.1 `npm run build && npm run typecheck && npm test` all green
- [ ] 7.2 Update README quickstart if behavior diverges; update AGENTS.md milestone status
