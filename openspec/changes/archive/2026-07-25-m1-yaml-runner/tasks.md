# Tasks: m1-yaml-runner

## 1. Project setup

- [x] 1.1 Install dependencies: `commander yaml zod ai @ai-sdk/anthropic @ai-sdk/openai playwright`; dev: `tsup vitest typescript @types/node tsx @types/yaml`
- [x] 1.2 Configure `tsup` (ESM bundle, `src/cli.ts` entry, shebang banner) and `vitest`

## 2. Config & test format

- [x] 2.1 `src/config.ts` — Zod schema + loader for `.blastproof/config.yaml` (defaults, actionable errors)
- [x] 2.2 `src/runner/testfile.ts` — YAML test file parser/validator (summary, steps, priority, tags, setup)
- [x] 2.3 `src/runner/env.ts` — `{{env.VAR}}` substitution + `maskSecrets` utility
- [x] 2.4 Unit tests for 2.1–2.3

## 3. LLM layer

- [x] 3.1 `src/llm/provider.ts` — factory: anthropic | openai | ollama (OpenAI-compatible baseURL), default models, fail-fast on missing key
- [x] 3.2 `src/llm/schemas.ts` — Zod schema for agent action (`navigate|click|fill|press|select|assert|done|fail`, target, value, reasoning, expectation)
- [x] 3.3 `src/llm/prompts.ts` — system prompt + per-iteration user prompt (step, snapshot, last action result)
- [x] 3.4 Unit tests with mocked model

## 4. Runner

- [x] 4.1 `src/runner/snapshot.ts` — `ariaSnapshot()` capture + trimming
- [x] 4.2 `src/runner/actions.ts` — action→Playwright mapping with `getByRole`/`getByLabel`/`getByText` fallback chain
- [x] 4.3 `src/runner/executor.ts` — per-step loop (retry budget, fresh context per test, screenshots on failure under `.blastproof/reports/<session>/`)
- [x] 4.4 Unit tests for executor loop with mocked LLM + mocked page

## 5. CLI

- [x] 5.1 `src/cli.ts` — commander wiring: `init`, `run` (+ `--tag`, `--priority`, `--query`), exit codes 0/1/2
- [x] 5.2 `src/commands/init.ts` — scaffold `.blastproof/` (idempotent, next-step guidance)
- [x] 5.3 `src/commands/run.ts` — discovery, filters, sequential execution, console summary table

## 6. Demo app & E2E validation

- [x] 6.1 `examples/demo-app/` — static pages: home, login (env-user/password), cart with promo-code discount
- [x] 6.2 `.blastproof/` sample tests targeting the demo app (created by `init`)
- [x] 6.3 Manual E2E: `init` → `run` against demo app with a real provider; verify pass and forced-failure paths (screenshot + exit 1)

## 7. Verify & docs

- [x] 7.1 `npm run build && npm run typecheck && npm test` all green
- [x] 7.2 Update README quickstart if behavior diverges; update AGENTS.md milestone status
