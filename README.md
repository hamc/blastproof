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

> **Status:** early MVP — `init`, `run` (including `--impacted`) and `plan` work today; the one-shot `test` pipeline and reports are on the roadmap below.

## Test format

Tests live in `.blastproof/tests/` as plain-English YAML — no selectors, no framework lock-in:

```yaml
summary: Checkout with discount
priority: P0
tags: [checkout, discount]
routes: ["/cart", "/checkout"]
steps:
  - add item to cart
  - apply promo code SAVE20
  - verify a 20% discount is applied
  - complete checkout
```

`priority` is P0–P2 (default P1); `tags` and `setup` steps are optional. `routes` (optional) declares the URLs a test covers: `blastproof run --impacted` runs only tests whose `routes:` intersect the routes affected by your PR diff (mapped from changed files via the `routes:` globs in `.blastproof/config.yaml`). Route strings compare by exact equality (`/cart` ≠ `/cart/` — write them consistently). Tests without `routes:` are skipped and reported under `--impacted`.

## CLI

| Command | Description |
| --- | --- |
| `blastproof init` | Scaffold `.blastproof/` config and sample tests (idempotent) |
| `blastproof run [--tag smoke] [--priority P0] [--query checkout]` | Run tests only — exit 0 pass, 1 fail, 2 usage/config error |
| `blastproof run --impacted [--base <ref>]` | Run only tests impacted by the diff vs the base ref (default `main`). Unrouted tests are skipped and reported; affected-but-uncovered routes are reported without failing the run |
| `blastproof run --dry-run` | Print the selection plan (affected routes, unmapped files, selected/skipped tests) and exit 0 — no browser launched, no LLM key needed |
| `blastproof run --url <url>` | Override `base_url` for this run only (e.g. a PR preview environment); the config file is never mutated |
| `blastproof plan [--base <ref>]` | Generate plain-English tests for affected routes no test covers yet. Prints drafts; nothing is written without `--write` |
| `blastproof plan --route <route>` | Generate for a route explicitly, skipping the diff (repeatable) — how you bootstrap coverage on an app with no suite yet |
| `blastproof plan --write` | Persist drafts to `.blastproof/tests/<route-slug>.yaml`. Never overwrites: a colliding filename fails that route |
| `blastproof run --min-score <n>` | Require a weighted score of at least `n` (0–100). **Replaces** the all-must-pass rule — see below |
| `blastproof run --junit [path]` | Write a JUnit XML report; without a path it lands in `.blastproof/reports/<session>/junit.xml` |

Coming next (roadmap): `blastproof test --base main` (full PR pipeline), `blastproof report`.

### Generating tests with `plan`

`plan` closes the gap `run --impacted` reports. It takes the affected routes no test covers, loads each one in the browser, and asks the model to write a test from the page's real accessibility tree plus the changed files that made the route impacted — so the generated steps name controls that actually exist:

```bash
blastproof plan --base main            # preview drafts for uncovered routes
blastproof plan --base main --write    # persist them, then review and commit
blastproof plan --route /checkout      # bootstrap a route without a diff
```

Drafts are **previews by default** — nothing touches disk until `--write`, and `--write` never overwrites an existing file, so a regeneration can't silently replace a test you edited by hand. Each written file carries a header recording its route, base ref and generation date. Review before committing: the steps are model-written and meant to be edited.

Exit codes: 0 when every route generated (or nothing needed coverage), 1 when a route failed, 2 on usage/config/diff errors. A route that fails to load never aborts the others.

**Known limitation:** a route behind authentication snapshots as the login wall, so its draft describes logging in rather than the feature. The `auth` config recipe is not applied by the planner yet — generate those routes after an auth session lands, or write them by hand.

### Score and merge gating

Every run ends with a score: the percentage of executed test **weight** that passed, where a test weighs 3 at P0, 2 at P1 and 1 at P2. Weighting is the point — a failing checkout costs three times a failing tooltip, so a pile of trivial passes can't hide a broken critical journey.

```bash
blastproof run                      # any failure exits 1 (strict, the default)
blastproof run --min-score 80       # passes at 80+, so one failing P2 is tolerated
blastproof run --min-score 100      # identical to the default strict behaviour
```

`--min-score` **replaces** the all-must-pass rule rather than adding to it. Without it, any failure exits 1. With it, the score alone decides — which is what lets you say "a P2 may break, a P0 may not" in one number. Only executed tests count: tests removed by `--tag`/`--priority`/`--query`, and tests skipped as unrouted under `--impacted`, are neither numerator nor denominator. A run that executed nothing scores 100 (the output says so explicitly), so a docs-only PR is never blocked.

For CI:

```bash
blastproof run --impacted --base "$BASE_REF" --min-score 80 --junit junit.xml
```

Exit 0 merge-able, 1 blocked, 2 usage/config error. The JUnit report carries the score as a `<property name="score">` so a parser can read it without scraping stdout, and tests skipped for having no `routes:` appear as `<skipped/>` cases — the coverage gap shows up in CI instead of vanishing.

## LLM providers (BYOK)

Bring your own key — runs 100% locally:

- **Anthropic** (`ANTHROPIC_API_KEY`)
- **OpenAI** (`OPENAI_API_KEY`)
- **Ollama** (local, no key needed)

## Roadmap

- [x] Repository & spec-driven development setup
- [x] **M1** — `init` + `run`: YAML test runner with agentic LLM executor
- [x] **M2** — diff analysis, impact mapping (`run --impacted`) and test generation (`plan`)
- [ ] **M3** — Reports and scoring: score + `--min-score` gate + JUnit done; HTML report and `blastproof test` pending
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
