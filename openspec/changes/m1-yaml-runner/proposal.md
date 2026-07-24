# Proposal: m1-yaml-runner

## Why

blastproof has no executable core yet. M1 delivers the minimum usable product: a developer can describe E2E tests in plain-English YAML and have an LLM-driven agent execute them on a real browser — the foundation every later milestone (diff analysis, impact mapping, scoring) builds on.

## What Changes

- Add `blastproof init`: scaffolds `.blastproof/` (config.yaml, tests/, sample test) in the target project
- Add `blastproof run`: discovers `.blastproof/tests/**/*.yaml`, executes each test agentically, exits non-zero on failure
- Add agentic executor: per-step loop using Playwright `ariaSnapshot()` + LLM structured output to decide and perform browser actions (`navigate`, `click`, `fill`, `press`, `select`, `assert`, `done`, `fail`), with a per-step retry budget (self-healing: elements re-resolved via accessibility tree on every attempt, no static selectors)
- Add LLM provider abstraction (Anthropic, OpenAI, Ollama) via Vercel AI SDK with Zod schemas
- Add config loading/validation for `.blastproof/config.yaml` (Zod)
- Add minimal console reporting (per-test pass/fail, per-step log, failure screenshots under `.blastproof/reports/`)
- Add a demo app under `examples/` to E2E-validate the runner without external services
- Add unit tests for config parsing, YAML test parsing, action mapping and executor loop (mocked LLM)

## Capabilities

### New Capabilities

- `project-init`: scaffolding of `.blastproof/` config and sample tests via `blastproof init`
- `yaml-test-format`: parsing/validation of plain-English YAML test files (summary, steps, priority, tags, setup, env placeholders)
- `agentic-execution`: LLM-driven step execution loop over Playwright with retry/self-healing and assertions
- `llm-providers`: provider factory and model resolution for Anthropic/OpenAI/Ollama
- `cli-run-command`: test discovery, filters (tag/priority/query), console reporting and exit codes

### Modified Capabilities

(none — first change)

## Non-goals

- No git diff analysis, impact mapping or test generation (M2)
- No JUnit/HTML reports or weighted scoring (M3)
- No GitHub Action, no npm publish (M4)
- No auth recipes, parallelism, or non-Chromium browsers

## Impact

- New dependencies: `commander`, `yaml`, `zod`, `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `playwright` (browser automation — core to the product); dev: `tsup`, `vitest`, `typescript`, `@types/node`, `tsx`
- All are runtime-standard, MIT-licensed, and map 1:1 to approved stack in AGENTS.md
- Affects: `src/` (new modules), `examples/demo-app/`, `tests/`
