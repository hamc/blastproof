# Design: m1-yaml-runner

## Context

Greenfield repo: only scaffolding (README, package.json, tsconfig) exists. M1 builds the executable core: YAML test parsing + agentic LLM execution over Playwright. This is the foundation for M2 (diff→impact→generation) and M3 (reports/score), so module boundaries must match the target architecture in AGENTS.md.

## Goals / Non-Goals

**Goals:**
- `blastproof init` and `blastproof run` working end-to-end against a local demo app
- Agentic per-step loop: snapshot → structured LLM action → Playwright execution, with retry budget and screenshots on failure
- Provider-agnostic LLM access (Anthropic/OpenAI/Ollama)
- Unit-testable modules with mocked LLM

**Non-Goals:**
- Diff analysis, test generation, scoring, JUnit/HTML reports, CI integration

## Decisions

### D1: Snapshot format — Playwright `ariaSnapshot()` over raw DOM
`page.locator('body').ariaSnapshot()` returns a compact YAML accessibility tree (roles, names, refs). It is drastically smaller than `outerHTML` (token cost), expresses intent (what a user perceives), and maps naturally to `getByRole` resolution. Alternatives considered: raw HTML (too many tokens, includes non-visible cruft), screenshot-only vision (higher cost/latency, worse text fidelity — may be added later as fallback).

### D2: LLM integration — Vercel AI SDK `generateObject` + Zod
One abstraction for Anthropic/OpenAI/Ollama with validated structured output, avoiding per-provider SDK code. Ollama is reached via its OpenAI-compatible endpoint (`@ai-sdk/openai` with custom baseURL). Alternative: hand-rolled provider adapters (more code, same result); LangChain (heavyweight, unneeded).

### D3: Single-step LLM loop, not multi-step planning
Each iteration asks for exactly one structured action: `{ action, target?: { role, name }, value?, reasoning, expectation? }`. The loop terminates on `done`/`fail` or budget exhaustion. Rationale: smaller prompts, deterministic control flow in our code (retries, screenshots, logging), easy to unit-test with a mocked model. Multi-action planning is a later optimization.

### D4: Action → Playwright mapping
`navigate` → `page.goto` (relative paths resolved against `base_url`); `click`/`fill`/`press`/`select` → element resolved from `{ role, name }` via `getByRole`, falling back to `getByLabel` then `getByText`; `assert` → LLM judges current snapshot against expectation (no DOM write). Every attempt re-snapshots — this IS the self-healing mechanism.

### D5: Config and secrets
`.blastproof/config.yaml` validated by Zod at load; `{{env.VAR}}` substituted in-memory only, never persisted; a `maskSecrets` utility replaces substituted values with `***` in all output channels.

### D6: Sequential execution, fresh context per test
One shared browser instance, one fresh `browser.newContext()` per test (isolation, low overhead). Worker parallelism deferred (post-MVP).

### D7: Demo app for self-validation
`examples/demo-app/`: a static multi-page site (login form, cart + discount flow) served by a tiny Node static server in tests, so the runner can be E2E-tested offline without external services.

## Risks / Trade-offs

- LLM latency per step (1 call/action) → keep snapshots trimmed (drop empty containers, cap depth), document cheap/fast models for local dev (Haiku, GPT-mini, Qwen via Ollama)
- `ariaSnapshot` may miss canvas/shadow-DOM content → documented limitation; vision fallback is post-MVP
- `generateObject` with small local models can produce invalid JSON → invalid output counts as a retry attempt; budget exhaustion yields a clean step failure, never a crash
- Playwright browser download size in CI/dev → document `npx playwright install chromium` in README/init output
