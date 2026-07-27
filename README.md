# blastproof

[![CI](https://github.com/hamc/blastproof/actions/workflows/ci.yml/badge.svg)](https://github.com/hamc/blastproof/actions/workflows/ci.yml)
[![Dogfood](https://github.com/hamc/blastproof/actions/workflows/dogfood.yml/badge.svg)](https://github.com/hamc/blastproof/actions/workflows/dogfood.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Open-source AI testing agent for pull requests.** Diff in, confidence out — no test scripts to write or maintain.

`blastproof` is an open-source AI QA agent for pull requests: it reads your PR diff, maps the blast radius, generates end-to-end tests in plain English, executes them on a real browser with self-healing, and scores the result before merge. 100% local, MIT licensed, bring your own LLM key.

```
git diff → impact mapping → test generation → agentic execution → report + score
```

## How it works

1. **Reads the diff** — `blastproof test --base main` parses the branch diff and maps it to affected routes.
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

> **Status:** the full pipeline works today — `init`, `run` (including `--impacted`), `plan` and `test`, with JUnit and HTML reports. Packaging and the GitHub Action are next (M4).

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
| `blastproof run --html [path]` | Write a self-contained HTML report with failure screenshots embedded inline |
| `blastproof test [--base <ref>]` | The full pipeline: run the tests covering the diff, then draft tests for the gaps |

### The full pipeline: `blastproof test`

One command for the whole loop — map the blast radius, run what covers it, draft what doesn't exist yet:

```bash
blastproof test --base main --min-score 80 --junit junit.xml --html report.html
```

It does two things and reports them separately:

1. **Verify** — executes the tests covering the affected routes, scores them, applies the gate
2. **Draft** — generates tests for affected routes no test covers, and prints them

**Generated drafts are never executed, and never affect the score.** That is deliberate. An unreviewed, model-written test in the merge path fails in two directions: a hallucinated expectation blocks a correct pull request, and a credulous one waves a broken change through while looking like coverage. Either costs more trust than the automation saves.

So read the result honestly: `test` does not make an uncovered route safe. It makes the gap visible, with a draft ready for you to review, and the score keeps describing only what was actually verified. Add `--write` to persist the drafts (never overwriting an existing file) and commit them once you have read them.

Exit codes: 2 usage/config/diff, 1 when the gate fails **or** a draft could not be generated, 0 otherwise.

### Reports

`--junit` is for CI; `--html` is for humans. The HTML report is a single self-contained file — inline CSS, screenshots embedded as data URIs, no scripts — so it opens offline, survives being moved, and uploads as one artifact. It leads with the score and gate verdict, sorts failures above passes, and expands each failure to its failing step, reason and screenshot.

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

### Closing the coverage hole

Impact mapping has a failure mode worth understanding. A changed file that matches no `routes:` glob contributes no affected routes — so a diff touching only a shared module selects nothing, scores 100 because nothing executed, and merges green. The information is printed, but nobody reads a passing run.

Each changed file is classified three ways:

| a changed file | means |
| --- | --- |
| matches a `routes:` glob | contributes its routes |
| matches an `ignore:` glob | knowingly irrelevant to any page |
| matches neither | **nobody has said what this affects** |

```yaml
routes:
  "src/cart/**": ["/cart", "/checkout"]
ignore:
  - "**/*.md"
  - ".github/**"
```

```bash
blastproof run --impacted --fail-on-unmapped
```

The flag fails the run on the third case only, naming the files and both ways to resolve them. `ignore:` is what makes that signal survivable — without it the flag would fire on every README edit and get switched off within a day, and a disabled gate protects nothing.

Nothing is ignored by default, on purpose: a file nobody has classified is exactly the risk the flag exists to surface, and a default that guesses on your behalf would hide the first files worth thinking about. This flag is **additive** — a run can meet its `--min-score` and still be blocked here, because "the tests I ran passed" and "something changed that nobody has classified" are different claims.

Be clear on its limit: it catches files that are *unclassified*, not files that are *misclassified*. A shared module mapped to one route when it can break five will still slip through. Mapping by import graph is the answer to that, and blastproof does not do it yet.

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

## blastproof tests itself

The **Dogfood** badge above is blastproof running against the demo app in this repo: real Chromium, real LLM, plain-English tests, scored and gated. The run logs are public — the agent's reasoning, step by step, is there to read.

It catches real regressions rather than diffing strings. Changing the demo app's discount from 20% to 5%, while leaving the on-screen message still claiming *"Promo code SAVE20 applied: 20% off"*, produces:

```
FAIL  P0  Promo code SAVE20 applies a 20% discount in the cart
  failing step: verify a 20% discount of $24.00 is shown
  reason: the discount is currently -$6.00, but a 20% discount on
          $120.00 should be -$24.00
Score: 50 — min-score 80: FAIL (below threshold)
```

No selector was updated and no assertion was rewritten to catch that. The agent read the rendered value, did the arithmetic, and disagreed with the page.

Two workflows, split by what they cost:

- **Impact** — runs on every pull request, including forks. Deterministic and keyless: it reports the blast radius of the diff and which tests cover it, before anyone spends a token.
- **Dogfood** — runs daily and on demand. The agentic run needs an API key, so it stays out of the merge path: a non-deterministic model answer should never block a merge.

## Testing behind a login

Most of a product lives behind authentication. Declare a recipe once and blastproof signs in a single time per run, then reuses that session for every test **and** for `plan` — so generated drafts describe the actual feature instead of the login wall.

Pick exactly one strategy:

```yaml
# 1) A plain-English login journey — form login, or anything a person can click through
auth:
  steps:
    - navigate to /login
    - fill the email field with {{env.TEST_EMAIL}}
    - fill the password field with {{env.TEST_PASSWORD}}
    - submit the login form
  verify: a signed-in indicator is visible    # optional, strongly recommended

# 2) A session captured by hand — for SSO, MFA or magic links
auth:
  storage_state: .blastproof/auth.json

# 3) Static values — for token-based apps
auth:
  headers:
    Authorization: "Bearer {{env.API_TOKEN}}"
```

A test that exercises the login itself must start signed out:

```yaml
summary: Login with valid credentials succeeds
auth: false
```

**`verify` is worth the one extra call.** Without it, a wrong password surfaces as every test failing on a login wall — N failures, none naming the cause. With it, the run stops before the first test and says what happened. Authentication failure exits 2 and never reports as failing tests: a login you cannot complete says nothing about the code under review, so it must not produce a score.

Each test still gets its own browser context; it simply starts from the shared session rather than empty, so isolation is unchanged. Set `auth.cache: true` to reuse a session across runs — off by default, because an expired session produces failures at random points with nothing pointing at the cause.

**A captured session is a credential.** The file holds live cookies: whoever has it is signed in as that user. `init` git-ignores it; never commit one.

> **Note on self-healing:** the executor recovers from failed steps by re-reading the page, which means it can complete a login using credentials the page itself displays — some apps show demo credentials on the sign-in form. That is the self-healing loop working as designed, but it does mean a deliberately-wrong password is not a reliable way to test your auth failure path.

## LLM providers (BYOK)

Bring your own key — runs 100% locally:

- **Anthropic** (`ANTHROPIC_API_KEY`)
- **OpenAI** (`OPENAI_API_KEY`)
- **Ollama** (local, no key needed)

### Configuring from the environment

You never have to commit a provider choice just to configure a pipeline. These variables override `.blastproof/config.yaml`, and precedence is **CLI flag > environment > file**:

| variable | overrides |
| --- | --- |
| `BLASTPROOF_BASE_URL` | `base_url` — the app under test |
| `BLASTPROOF_LLM_PROVIDER` | `anthropic` \| `openai` \| `ollama` |
| `BLASTPROOF_LLM_MODEL` | the model name |
| `BLASTPROOF_LLM_BASE_URL` | the provider endpoint — *not* the app |
| `BLASTPROOF_LLM_API_KEY_ENV` | the **name** of the variable holding your key |

Running the committed config against an OpenAI-compatible gateway, without editing a file:

```bash
export BLASTPROOF_LLM_PROVIDER=openai
export BLASTPROOF_LLM_MODEL=anthropic/claude-haiku-4.5
export BLASTPROOF_LLM_BASE_URL=https://openrouter.ai/api/v1
export BLASTPROOF_LLM_API_KEY_ENV=OPENROUTER_API_KEY
blastproof run --impacted --min-score 80
```

Note the last one names *which variable* holds your key — the key itself is never read from a `BLASTPROOF_*` variable, so error messages can keep naming the variable you chose. An empty value counts as unset, so `FOO=` in a CI matrix will not blank a configured setting.

## Roadmap

- [x] Repository & spec-driven development setup
- [x] **M1** — `init` + `run`: YAML test runner with agentic LLM executor
- [x] **M2** — diff analysis, impact mapping (`run --impacted`) and test generation (`plan`)
- [x] **M3** — Reports (JUnit + HTML), priority-weighted score, `--min-score` gate, `blastproof test`
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
