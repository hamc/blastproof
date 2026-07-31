# blastproof

[![CI](https://github.com/hamc/blastproof/actions/workflows/ci.yml/badge.svg)](https://github.com/hamc/blastproof/actions/workflows/ci.yml)
[![Dogfood](https://github.com/hamc/blastproof/actions/workflows/dogfood.yml/badge.svg)](https://github.com/hamc/blastproof/actions/workflows/dogfood.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Open-source AI testing agent for pull requests.** Write end-to-end tests as plain English. An agent drives a real browser to run them, selects only the ones your diff can affect, and scores the result before merge.

```
git diff → impact mapping → test generation → agentic execution → report + score
```

100% local. MIT. Bring your own LLM key.

## Quick start

```bash
npm install -g blastproof                  # Node.js >= 20.19
cd your-project
blastproof init                            # scaffolds .blastproof/
```

Point `base_url` at your running app in `.blastproof/config.yaml`, then check the setup — this needs **no API key and no browser**:

```bash
blastproof run --dry-run
```

To actually execute tests you need a browser and a model:

```bash
npx playwright install --with-deps chromium   # NEEDS SUDO — see below
export ANTHROPIC_API_KEY=...                  # or OPENAI_API_KEY, or local Ollama
blastproof run
```

**No sudo?** `--with-deps` installs system libraries as root. Without it, run `npx playwright install chromium` and obtain `libnspr4`, `libnss3`, `libnssutil3` and `libasound2` however you can. Note that a useful half of blastproof needs neither browser nor key — see [Without a browser or a key](#without-a-browser-or-a-key).

Before `run`, `plan` or `test` do anything, they check what they are about to spend — the browser can launch, the model provider is reachable, `base_url` responds — and report every unmet one together, so a stopped app or a missing browser is never a wall you hit one crash at a time. A missing system library names the exact install command and says it needs root; nothing is installed on your behalf. Silent when everything is fine, and skipped entirely by `--dry-run`, which needs none of it.

## Does this fit your application?

**Your markup must be accessible — a hard requirement.** Elements are found by role, label or visible text from the accessibility tree. That is what removes selectors and survives redesigns; the cost is that an interface the accessibility tree cannot describe cannot be driven at all, and there is deliberately no CSS or XPath fallback. Icon-only buttons without accessible names, `div`-based controls and ARIA-less dropdowns simply cannot be targeted. Run an accessibility checker first — the result predicts how well this will work better than anything else.

**Not supported yet:** `iframe` content (so hosted payment widgets like Stripe Elements are invisible — an embedded checkout cannot be driven end to end), hover, scroll-to, drag and drop, file upload, multiple tabs, native `alert`/`confirm` dialogs. Page snapshots are capped at 200 lines by default, so very dense pages are truncated — raise it with `browser.max_snapshot_lines` if your pages need more; truncation is always marked in the snapshot so the model is never misled into thinking it saw the whole page.

**Point it at disposable data.** Within a step, an action that commits — a click, or pressing Enter — is never performed twice: the runner refuses the repeat and tells the agent it already did that. This closes the case that used to produce duplicate records, where a submit answered by a redirect came back to a reset form and the agent, seeing no evidence of its own work, submitted again. It is not a guarantee of zero duplicate writes: an agent that reaches the same effect by a genuinely different route — another control with the same effect — is not caught. Use a seeded database, a staging environment you can reset, or a throwaway account; do not gate on a run against production data.

`browser.timeout_ms` bounds every wait — resolving a target element from the accessibility tree, and navigation — not only the click or fill performed afterwards. Raise it for an application that is merely slow to hydrate; the trade-off is that a genuinely missing element then takes longer to fail. It never changes how many self-healing retries a step gets — waiting and retrying are deliberately separate.

Writing each step so it states its own outcome helps here as well as everywhere else: `submit the form, then verify the confirmation shows the reference number` gives the agent something to check, where `click the submit button` leaves it to invent an expectation — and a poor invented expectation is what turns one submission into three.

**This is now load-bearing, not just advisable.** The judge decides whether a step's own outcome holds, using the model's expectation only as the claim offered in support of it — a step that never says what its outcome is gives the judge nothing to anchor on beyond whatever the model happened to check that turn. `verify the confirmation shows the reference number` gives the judge a real question; `verify it worked` does not, and may now fail where a looser judge previously let a true-but-unrelated claim pass it.

## Writing tests

Tests live in `.blastproof/tests/` as plain-English YAML — no selectors:

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

`priority` is P0–P2 (default P1). `tags`, `setup` steps and `auth` are optional — `auth: false` runs the test signed out, which a login test needs. `routes` declares the URLs a test covers, which is what `--impacted` selects on; write route strings consistently, since they compare by exact equality (`/cart` ≠ `/cart/`).

## Commands

```bash
blastproof init                          # scaffold .blastproof/
blastproof run                           # run every test
blastproof run --impacted --base main    # run only what the diff can affect
blastproof plan --base main              # draft tests for uncovered routes
blastproof test --base main              # run what covers the diff, then draft the gaps
```

Common flags — `blastproof <command> --help` has the full list:

| flag | |
| --- | --- |
| `--dry-run` | Print the selection (or, for `plan`, the routes it would draft) and exit. No browser, no API key |
| `--tag` · `--priority` · `--query` | Select a subset of tests |
| `--url <url>` | Override `base_url` for this run (e.g. a PR preview) |
| `--min-score <n>` | Gate on a weighted score instead of all-must-pass |
| `--fail-on-unmapped` | Fail when a changed file matches no `routes:` or `ignore:` glob |
| `--junit [path]` · `--html [path]` | Write reports |
| `--write` | `plan` only — persist drafts instead of previewing |
| `--max-llm-calls` · `--max-tokens` · `--max-duration` | Bound what a run may spend |

Exit codes: **0** pass, **1** the gate failed, **2** usage or config error.

**Generated drafts are never executed and never affect the score.** An unreviewed model-written test in the merge path fails in two directions: a hallucinated expectation blocks a correct PR, and a credulous one waves a broken change through while looking like coverage. `plan` makes the gap visible with a draft to review; it does not make an uncovered route safe.

## In CI

```yaml
name: blastproof
on: pull_request

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # required — the diff needs a merge-base

      - run: npm start &          # however your app boots

      - uses: hamc/blastproof@v0.7.0
        with:
          version: '0.6.0'        # pin both when this gates merges
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          base: ${{ github.event.pull_request.base.ref }}
          min-score: '80'
          fail-on-unmapped: 'true'
```

A non-zero exit blocks the merge. The action outputs `score` (0–100, empty when no report was produced) for later steps. Full input list: [`action.yml`](./action.yml).

`fetch-depth: 0` is not optional — the default checkout is shallow and has no merge-base. The action detects this and fails immediately rather than letting it surface as a git error mid-run.

## Impact mapping

`--impacted` runs only the tests whose `routes:` intersect the routes your diff can affect, mapped from changed files by globs you maintain in `.blastproof/config.yaml`:

```yaml
routes:
  "src/cart/**": ["/cart", "/checkout"]
ignore:
  - "**/*.md"
```

Every changed file lands in one of three buckets: it matches `routes:` and contributes them, matches `ignore:` and is knowingly irrelevant, or **matches neither — nobody has said what it affects**. `--fail-on-unmapped` blocks on that third case, naming the files and both ways to resolve them.

**Nothing is ignored by default**, on purpose: a default that guesses on your behalf would hide the first files worth thinking about. The flag is additive — a run can meet `--min-score` and still be blocked here, because "the tests I ran passed" and "something changed that nobody classified" are different claims.

Its limit is worth knowing: it catches files that are *unclassified*, not *misclassified*. A shared module mapped to one route when it can break five still slips through. Impact by import graph is the fix, and blastproof does not do it yet.

## Score and merge gating

Each run scores the percentage of executed test **weight** that passed, weighing 3 at P0, 2 at P1, 1 at P2 — so a failing checkout costs three times a failing tooltip.

```bash
blastproof run                   # any failure exits 1 (strict, the default)
blastproof run --min-score 80    # one failing P2 is tolerated
```

`--min-score` **replaces** the all-must-pass rule rather than adding to it. Only executed tests count: filtered and unrouted tests are neither numerator nor denominator, and a run that executed nothing scores 100, so a docs-only PR is never blocked. JUnit carries the score as a `<property name="score">`, and unrouted tests appear as `<skipped/>` so the coverage gap shows up in CI rather than vanishing.

## Without a browser or a key

Half of blastproof is deterministic and free. These need no model, no browser and no network:

```bash
blastproof run --dry-run                              # what would run
blastproof run --impacted --dry-run                   # + which routes the diff touches
blastproof run --impacted --fail-on-unmapped --dry-run # + gate on unclassified files
blastproof plan --base main --dry-run                 # affected routes no test covers, no key needed
```

They report affected routes, files nobody has classified, and affected routes no test covers — a coverage-gap report with an exit code, useful even on a repo whose suite is Playwright or Cypress.

## Bounding a run

Nothing stops a run by default. `budget:` puts a ceiling on `run`, `plan` and `test` alike — every model call any of them makes is counted:

```yaml
budget:
  max_llm_calls: 500
  max_tokens: 2000000
  max_duration_s: 900
```

Each limit is optional; with none set, nothing binds. They count **calls and tokens, not currency** — a price table keyed by model and provider goes stale the day a provider reprices, and a limit that quietly stops meaning what it says is worse than none, because it is trusted.

Exhausting a budget **stops the run; it does not fail a test.** Running out of quota says nothing about the code under review. Unreached tests are reported as `not run`, a third state excluded from the score entirely, and the process exits 1 unconditionally — `--min-score` cannot rescue it, because the tests that finished are whichever ran first, not a representative sample.

`--dry-run` reports the ceiling before you spend anything.

## Testing behind a login

Declare a recipe once; blastproof signs in one time per run and reuses that session for every test and for `plan`. Pick exactly one strategy:

```yaml
# 1) A plain-English journey — form login, or anything a person can click through
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

**`verify` is worth the extra call.** Without it a wrong password surfaces as every test failing on a login wall — N failures, none naming the cause. Authentication failure exits 2 and never reports as failing tests, because a login you cannot complete says nothing about the code under review.

**A captured session is a credential** — the file holds live cookies. `init` git-ignores it; never commit one.

## LLM providers (BYOK)

**Anthropic** (`ANTHROPIC_API_KEY`), **OpenAI** (`OPENAI_API_KEY`), or **Ollama** (local, no key). Any setting can be overridden from the environment, with precedence **CLI flag > environment > file**:

| variable | overrides |
| --- | --- |
| `BLASTPROOF_BASE_URL` | `base_url` — the app under test |
| `BLASTPROOF_LLM_PROVIDER` | `anthropic` \| `openai` \| `ollama` |
| `BLASTPROOF_LLM_MODEL` | the model name |
| `BLASTPROOF_LLM_BASE_URL` | the provider endpoint — *not* the app |
| `BLASTPROOF_LLM_API_KEY_ENV` | the **name** of the variable holding your key |
| `BLASTPROOF_MAX_LLM_CALLS` · `BLASTPROOF_MAX_TOKENS` · `BLASTPROOF_MAX_DURATION_S` | the budget fields |

So an OpenAI-compatible gateway needs no file edit:

```bash
export BLASTPROOF_LLM_PROVIDER=openai
export BLASTPROOF_LLM_MODEL=anthropic/claude-haiku-4.5
export BLASTPROOF_LLM_BASE_URL=https://openrouter.ai/api/v1
export BLASTPROOF_LLM_API_KEY_ENV=OPENROUTER_API_KEY
blastproof run --impacted --min-score 80
```

The key itself is never read from a `BLASTPROOF_*` variable — you name *which* variable holds it, so errors can keep naming the one you chose.

## Trust boundaries

The application under test is not trusted input: its page content reaches the model, so a page that controls its own accessible text can try to influence the agent. Two things constrain that.

**The agent cannot leave your application.** The boundary is `base_url`'s origin plus whatever `allowed_origins:` declares, and it constrains where the page **is**, not only where an action asked to go. A `navigate` outside it is refused before the request; a page that ends up outside it any other way — a redirect, a link to another host, a script setting the location — fails the step, and its content is never sent to the model. Enforced by comparison, not by asking the model nicely.

If your application legitimately spans hosts (an identity provider, a hosted payment step), declare them. A suite that was quietly walking onto a foreign page will now fail and name the origin to add.

**Your secrets stay out of prompts.** `{{env.*}}` placeholders survive intact and are substituted at the moment of typing. Every value your tests or auth recipe reference is redacted from everything else crossing into a prompt — page snapshots included — in literal and percent-encoded form. Redaction matches known values, so treat it as a strong default rather than a guarantee against a hostile app.

The system prompt also tells the model that page content is data, never instruction. That raises the cost of casual injection and is **not** a boundary — the origin constraint is. Do not point blastproof at an application you would not run locally.

## blastproof tests itself

The **Dogfood** badge is blastproof running against the demo app in this repo — real Chromium, real model, scored and gated, with public logs. It catches real regressions rather than diffing strings: change the demo discount from 20% to 5% while the page still claims *"20% off"* and it reports

```
FAIL  P0  Promo code SAVE20 applies a 20% discount in the cart
  reason: the discount is currently -$6.00, but a 20% discount on
          $120.00 should be -$24.00
```

No selector was updated to catch that. The agent read the value, did the arithmetic, and disagreed with the page.

Try it yourself:

```bash
git clone https://github.com/hamc/blastproof && cd blastproof
npm install && npm run build
node examples/demo-app/serve.mjs 4173 &
export ANTHROPIC_API_KEY=...
node dist/cli.js run
```

## Development

Built with AI assistance using spec-driven development: every change began as a written proposal with its design rationale, and those documents are kept rather than discarded. `openspec/` holds the reasoning behind each decision, including the alternatives that were rejected and why — start at [`AGENTS.md`](./AGENTS.md) for architecture, conventions and the contribution workflow. Open work lives in [issues](https://github.com/hamc/blastproof/issues).

```bash
npm install && npm run build && npm test
```

## License

[MIT](./LICENSE)
