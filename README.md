# blastproof

**Open-source AI testing agent for pull requests.** Diff in, confidence out — no test scripts to write or maintain.

`blastproof` is the open-source alternative to [DevAssure](https://www.devassure.io/): an AI QA agent that reads your PR diff, maps the blast radius, generates end-to-end tests in plain English, executes them on a real browser with self-healing, and scores the result before merge.

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
cd your-project
blastproof init
export ANTHROPIC_API_KEY=...   # or OPENAI_API_KEY, or use a local Ollama model
blastproof test --base main --url http://localhost:3000
```

> **Status:** early MVP — see the roadmap below. The CLI is under active development.

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
| `blastproof init` | Scaffold `.blastproof/` config and a sample test |
| `blastproof test --base main [--url] [--min-score 75]` | Full PR pipeline: diff → impact → generate → run → score |
| `blastproof run [--tag smoke] [--priority P0]` | Run existing tests only |
| `blastproof plan --base main` | Generate tests without executing |
| `blastproof report --last` | Summary of the last session |

## LLM providers (BYOK)

Bring your own key — runs 100% locally:

- **Anthropic** (`ANTHROPIC_API_KEY`)
- **OpenAI** (`OPENAI_API_KEY`)
- **Ollama** (local, no key needed)

## Roadmap

- [x] Repository & spec-driven development setup
- [ ] **M1** — `init` + `run`: YAML test runner with agentic LLM executor
- [ ] **M2** — `test`: diff analysis, impact mapping, test generation
- [ ] **M3** — Reports (JUnit/HTML), scoring, exit codes
- [ ] **M4** — GitHub Action, npm publish
- [ ] Post-MVP — VS Code extension, session replay, worker parallelism

## Development

This project uses **spec-driven development** via [OpenSpec](https://github.com/Fission-AI/OpenSpec). See [`AGENTS.md`](./AGENTS.md) for architecture, conventions and the contribution workflow — every change starts with an OpenSpec proposal.

```bash
asdf install        # Node.js (see .tool-versions)
npm install
npm run build
npm test
```

## License

[MIT](./LICENSE)
