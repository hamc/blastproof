# blastproof

**Open-source AI testing agent for pull requests.** Diff in, confidence out — no test scripts to write or maintain.

`blastproof` is an open-source AI QA agent for pull requests: it reads your PR diff, maps the blast radius, generates end-to-end tests in plain English, executes them on a real browser with self-healing, and scores the result before merge. 100% local, MIT licensed, bring your own LLM key.

```
git diff → impact mapping → test generation → agentic execution → report + score
```

## How it works

1. **Reads the diff** — `blastproof test --base main` parses the branch diff and builds change context.
2. **Maps the blast radius** — traces changed files to the user journeys and routes most likely affected.
3. **Generates tests** — writes/updates plain-English YAML tests in `.blastproof/tests/`.
4. **Executes agentically** — an LLM-driven loop over Playwright resolves elements via the accessibility tree on every step. No static selectors, so no flakiness: the agent re-resolves when the UI shifts.
5. **Reports & scores** — console, JUnit XML and HTML reports, plus a priority-weighted score that fails the run below `--min-score`.

## Quick start

```bash
npm install -g blastproof
npx playwright install chromium   # one-time browser download
cd your-project
blastproof init
export ANTHROPIC_API_KEY=...      # or OPENAI_API_KEY, or use a local Ollama model
blastproof run                    # discovers .blastproof/tests/**/*.yaml and runs them agentically
```

Try it locally without your own app — this repo ships a demo shop:

```bash
node examples/demo-app/serve.mjs 4173 &   # home, login and cart + promo-code pages
blastproof init
export ANTHROPIC_API_KEY=...
blastproof run
```

> **Status:** early MVP — `init` and `run` work today; the diff pipeline (`test`, `plan`) and reports are on the roadmap below.

## Test format

Tests live in `.blastproof/tests/` as plain-English YAML — no selectors, no framework lock-in:

```yaml
summary: Checkout with discount
priority: P0
tags: [checkout, discount]
steps:
  - add item to cart
  - apply promo code SAVE20
  - verify a 20% discount is applied
  - complete checkout
```

## CLI

| Command | Description |
| --- | --- |
| `blastproof init` | Scaffold `.blastproof/` config and sample tests (idempotent) |
| `blastproof run [--tag smoke] [--priority P0] [--query checkout]` | Run tests only — exit 0 pass, 1 fail, 2 usage/config error |

Coming next (roadmap): `blastproof test --base main` (full PR pipeline), `blastproof plan`, `blastproof report`.

## LLM providers (BYOK)

Bring your own key — runs 100% locally:

- **Anthropic** (`ANTHROPIC_API_KEY`)
- **OpenAI** (`OPENAI_API_KEY`)
- **Ollama** (local, no key needed)

## Roadmap

- [x] Repository & spec-driven development setup
- [x] **M1** — `init` + `run`: YAML test runner with agentic LLM executor
- [ ] **M2** — `test`: diff analysis, impact mapping, test generation
- [ ] **M3** — Reports (JUnit/HTML), scoring, exit codes
- [ ] **M4** — GitHub Action, npm publish
- [ ] Post-MVP — VS Code extension, session replay, worker parallelism

## Development

This project uses **spec-driven development** via [OpenSpec](https://github.com/Fission-AI/OpenSpec). See [`AGENTS.md`](./AGENTS.md) for architecture, conventions and the contribution workflow — every change starts with an OpenSpec proposal.

```bash
# requires Node.js >= 20.19 (see engines in package.json)
npm install
npm run build
npm test
```

## License

[MIT](./LICENSE)
