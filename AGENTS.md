# AGENTS.md — blastproof

> Central context for AI agents and contributors. Read this before touching code.

## Mission

**blastproof** is an open-source AI testing agent for pull requests. Given a code diff, it maps the blast radius, generates plain-English E2E tests, executes them on a real browser through an agentic self-healing loop, and reports a score that can gate merges. 100% local, BYOK (bring your own LLM key). MIT licensed.

Pipeline: `git diff → impact mapping → test generation → agentic execution → report + score`

## Capabilities and scope

| Capability | blastproof MVP |
| --- | --- |
| PR diff analysis | ✅ `blastproof test --base main` |
| Blast radius mapping | ✅ heuristics (config `routes:` globs) + LLM fallback |
| Plain-English YAML tests | ✅ `.blastproof/tests/*.yaml` (summary, steps, priority, tags) |
| Scriptless agentic execution | ✅ own loop: Playwright `ariaSnapshot()` + LLM structured output |
| Self-healing (no static selectors) | ✅ elements re-resolved by role/name every step |
| Score with merge threshold | ✅ priority-weighted (P0=3, P1=2, P2=1), `--min-score` gate |
| JUnit/HTML reports, PR comment | ✅ JUnit + HTML locally (M3); GitHub Action (M4) |
| SaaS backend, credits, dashboards | ❌ never — local-first BYOK |
| VS Code extension, Flutter, session replay | ❌ post-MVP |

## Tech stack

- **Runtime**: Node.js ≥ 20.19 (see `engines` in `package.json`; use any version manager you like), TypeScript strict, ESM (`"type": "module"`, NodeNext resolution)
- **Browser**: Playwright (Chromium only in MVP) — snapshots via `page.locator('body').ariaSnapshot()`
- **LLM**: Vercel AI SDK (`generateObject` + Zod schemas) — providers: Anthropic, OpenAI, Ollama (OpenAI-compatible)
- **CLI**: commander · **Config/tests**: `yaml` · **Git**: simple-git · **Build**: tsup · **Tests**: vitest
- **SDD**: OpenSpec (`openspec/` + slash commands `/opsx:*`)

## Target architecture (`src/`)

```
src/
  cli.ts            # entry: init | test | run | plan | report
  config.ts         # loads .blastproof/config.yaml (zod-validated)
  diff.ts           # git diff base...head → changed files + context
  impact.ts         # diff + route hints → affected journeys/URLs
  planner.ts        # generates/updates YAML tests for impacted journeys
  runner/
    executor.ts     # agentic per-step loop (retry budget, self-heal)
    snapshot.ts     # ariaSnapshot capture + trimming
    actions.ts      # navigate/click/fill/press/select/assert via getByRole
  llm/
    provider.ts     # AI SDK provider factory (anthropic|openai|ollama)
    prompts.ts      # system/user prompts for plan + execute + assert
  report/
    console.ts      # terminal table
    junit.ts        # JUnit XML (CI-compatible)
    html.ts         # HTML report with failure screenshots
    score.ts        # priority-weighted score
```

### Conventions

- **Test files** (the product's, not ours): `.blastproof/tests/**/*.yaml` — fields `summary` (required), `steps` (required, plain English), `priority` (P0–P2), `tags`, optional `setup`, `{{env.VAR}}` placeholders for secrets
- **Config**: `.blastproof/config.yaml` — `base_url`, `llm.{provider,model,api_key_env}`, `browser`, `routes` (glob→URLs impact hints), optional `auth` recipe
- No static selectors anywhere in generated tests or runner state — resolution is always live via accessibility tree
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:` …), one-line subject
- Never log secrets; `{{env.*}}` values are masked in reports

## Spec-driven development workflow (REQUIRED)

This repo uses [OpenSpec](https://github.com/Fission-AI/OpenSpec). **No code change without an approved change proposal.**

1. **Propose** — `/opsx:propose "<what>"` (or `openspec new change <kebab-name>` + author artifacts). Creates `openspec/changes/<name>/` with `proposal.md`, `design.md`, `tasks.md` and spec deltas under `specs/`
2. **Review** — human reviews the proposal before implementation
3. **Apply** — `/opsx:apply` implements tasks from `tasks.md`, checking them off
4. **Archive** — `/opsx:archive` merges deltas into `openspec/specs/` (living source of truth)

Rules:

- Keep proposals small (one milestone/feature per change)
- Specs use `SHALL` requirements with `WHEN/THEN` scenarios
- Update `tasks.md` checkboxes as you complete work
- If implementation diverges from design, update the change artifacts first

## Multi-agent workflow (optional, opencode)

Subagents in `.opencode/agents/` mirror a small delivery team with strict separation of duties (file permissions enforce it):

- `dev` — implements tasks from an approved OpenSpec change (code + unit tests). Never touches `openspec/` artifacts, never commits.
- `qa` — verifies: build/typecheck/test + E2E against `examples/demo-app/`; owns `DEFECTS.md` and is the only role that closes defects. Never edits product code.
- `sentinel` — read-only reviewer: secret leaks/masking, static selectors, unjustified dependencies, spec and convention drift. Never edits anything.

Delegate via the Task tool. The primary agent (or the human) orchestrates: dispatches tasks, triages defects, and checks off `tasks.md` boxes only after `qa` verifies.

## Build, test, verify

```bash
# requires Node.js >= 20.19 (see engines in package.json)
npm install
npm run build         # tsup → dist/
npm test              # vitest
npm run typecheck     # tsc --noEmit
```

Before considering any task done: `build`, `test` and `typecheck` must pass. E2E validation of the CLI itself uses the demo app in `examples/` (added in M1).

## Milestones

| # | Scope | Status |
| --- | --- | --- |
| M1 | `init` + `run`: YAML runner with agentic LLM executor + demo app | implemented (`openspec/changes/m1-yaml-runner`) |
| M2 | `test`/`plan`: diff analysis, impact mapping, test generation | m2a (`run --impacted`) implemented (`openspec/changes/m2a-impacted-runs`); m2b (planner) pending |
| M3 | Reports (JUnit/HTML), scoring, exit codes | pending |
| M4 | GitHub Action, npm publish | pending |

Post-MVP (do not build unless asked): VS Code extension, session replay, worker parallelism, Flutter, GitHub PR comments.

## Guardrails

- Make minimal changes; follow existing file structure
- Never commit secrets or `.env` (gitignored)
- Don't add dependencies without justification in the change proposal
- Keep the CLI output machine-friendly: human tables on stdout, artifacts under `.blastproof/reports/`
