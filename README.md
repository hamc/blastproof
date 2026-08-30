<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/hamc/blastproof/main/.github/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/hamc/blastproof/main/.github/logo-light.svg" alt="" width="30" height="30">
  </picture>
  blastproof
</h1>

[![CI](https://github.com/hamc/blastproof/actions/workflows/ci.yml/badge.svg)](https://github.com/hamc/blastproof/actions/workflows/ci.yml)
[![Dogfood](https://github.com/hamc/blastproof/actions/workflows/dogfood.yml/badge.svg)](https://github.com/hamc/blastproof/actions/workflows/dogfood.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Open-source AI testing agent for pull requests.** Write end-to-end tests as plain English. An agent drives a real browser to run them, selects only the ones your diff can affect, and scores the result before merge.

```
git diff → impact mapping → test generation → agentic execution → report + score
```

100% local. MIT. Bring your own LLM key.

<img src="https://raw.githubusercontent.com/hamc/blastproof/main/.github/dogfood.gif" width="100%"
     alt="A terminal running blastproof against this repo's demo app. It passes four steps, then fails
          step 5: the page says the SAVE20 promo gave 20% off, but the discount shown is -$6.00 where
          20% of $120.00 would be -$24.00. Score: 0.">

▶ **[Watch the introduction](https://www.youtube.com/shorts/miqN5FzMF_k)** — what it does, in a minute.

**Documentation:** [Configuration](./docs/configuration.md) · [Testing behind a login](./docs/auth.md) · [Running in CI](./docs/ci.md) · [Contributing](./CONTRIBUTING.md) · [Architecture](./AGENTS.md)

## Set it up with your coding agent

Most of what the setup asks — which stack, which port, which journeys matter — is a question your coding agent can already answer by looking at your project. So let it answer them:

```bash
npx skills add hamc/blastproof
```

Then tell your agent: **"set up e2e tests"**. The skill installs for whichever agents you have — Claude Code, Cursor, Codex and others — and walks the whole path: check whether your markup is reachable at all, pick a provider, scaffold, generate drafts from your *running* app, curate them, run them, and write down the accessibility constraints that keep the suite alive as the project grows.

Two things it deliberately will not do, so their absence does not read as a defect: it does not configure [authentication](./docs/auth.md), and it does not wire up [CI](./docs/ci.md). Both are worth doing after you have seen a green run on your own machine.

The skill lives in [`skills/blastproof/`](./skills/blastproof/) and is worth reading even if you never install it. [`references/authoring.md`](./skills/blastproof/references/authoring.md) sets out what separates a test that detects something from one that reports Score 100 and detects nothing — including two drafts this tool generated that passed unedited and were worth nothing.

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

Provider options, budgets and browser tuning: [Configuration](./docs/configuration.md).

## Does this fit your application?

Three questions. The first one decides most cases.

### 1. Is your markup accessible?

**A hard requirement, not a preference.** blastproof finds elements the way a screen reader does — by role, by label, by visible text. That is what removes selectors and survives redesigns. The cost is that there is deliberately no CSS or XPath fallback, so anything the accessibility tree cannot describe cannot be driven at all.

| works | cannot be driven |
| --- | --- |
| `<button>Add to cart</button>` | a `<div>` with a click handler |
| `<label for="email">` + `<input>` | an input with no label |
| `<button aria-label="Delete note">` | an icon-only button with no name |
| `<select>` with `<option>`s | an ARIA-less custom dropdown |

**Run an accessibility checker on your app before installing anything.** The result predicts how well this will work better than anything else you could measure — and the fixes it suggests are worth making regardless of whether you adopt this tool.

### 2. Does your journey need anything on this list?

Not supported yet:

- **`iframe` content** — a hosted payment widget is invisible, so an embedded checkout cannot be driven end to end
- **hover, scroll-to, drag and drop, file upload**
- **multiple tabs**, and native `alert` / `confirm` dialogs

**Windows is untested.** Development and CI run on Linux and macOS. Nothing is known to be broken and reports are welcome ([#8](https://github.com/hamc/blastproof/issues/8)).

If a critical journey needs one of these, that journey stays with your existing test suite. The two can coexist — nothing here replaces what you already have.

### 3. Can you point it at data you can throw away?

**Use a seeded database, a staging environment you can reset, or a throwaway account. Do not gate on a run against production data.**

Within a step, an action that commits — a click, or pressing Enter — is never performed twice: the runner refuses the repeat and tells the agent it already did that. This closes the case that used to produce duplicate records, where a submit answered by a redirect came back to a reset form and the agent, seeing no evidence of its own work, submitted again.

It is **not** a guarantee of zero duplicate writes. An agent that reaches the same effect by a genuinely different route — another control that does the same thing — is not caught.

## How it works

<img src="https://raw.githubusercontent.com/hamc/blastproof/main/.github/coverage-flow.svg" width="100%"
     alt="How a diff becomes a merge decision. In CI, unattended: changed files are matched against the routes: and ignore: globs; matched files contribute affected routes, files matching neither are reported as unclassified and fail the run only under --fail-on-unmapped. Tests declaring an affected route are executed and produce a weighted score, which --min-score gates on. An affected route no test declares is reported as a coverage gap and never fails the run. Separately and manually, outside CI: blastproof plan loads such a route in Chromium, makes one model call, and produces a YAML draft you review, edit and run before committing it.">

**The boundary in the middle is the point.** Everything above it runs unattended on every pull request and ends in an exit code. Everything below it is something you choose to run, on your machine, and review before it lands.

A route no test covers is *reported*, never failed — blocking on it would punish you for an incomplete map instead of teaching you to complete it. Turning that report into a test is the manual half, and the draft it produces is not trusted until a person has read it.

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

`priority` is P0–P2 (default P1). `tags`, `setup` steps and `auth` are optional — `auth: false` runs the test signed out, which a login test needs. `routes` declares the URLs a test covers, which is what `--impacted` selects on; write route strings consistently, since they compare by exact equality (`/cart` ≠ `/cart/`). `run` warns to stderr — non-fatal — when a test declares a route no `routes:` mapping declares, since that route contributes nothing to `--impacted` selection.

### Say what each step should produce

This is the one rule that decides whether a suite works. An outside evaluation took the **same application, same suite, same version from Score 64 to Score 100 by rewriting two steps** — nothing else changed:

```yaml
# Fragile: a bare action. Nothing says what should be true afterwards.
- submit the add-task form
- verify the new task "Fix the flaky test" appears in the task list

# Robust: the step carries its own outcome.
- submit the add-task form and verify the task "Fix the flaky test" appears
  in the task list with priority High and status Open
```

The bare version fails on a shape that is everywhere: the form POSTs, the server redirects back to the same page, and the form comes back empty. The agent is asked whether "submit the add-task form" happened, and is looking at a page that is indistinguishable from one where nothing did. A step that names the outcome gives it something to check that survives the action.

Write steps that end in an observable result — text on the page, a count, a state change — and this class of failure does not arise.

**Inline error messages should be plain visible text.** `role="alert"` is read correctly from the accessibility tree and needs no special handling, but note that an alert your page has cleared shows up as an empty element: if a verdict says an alert exists whose content is missing, the message was emptied, not hidden.

### A step that enters a value writes the value

```yaml
- fill the note field with Order not received   # runs
- fill the note field                           # cannot run
```

The agent is **forbidden from inventing values** — one it types must come from the step, from the page, or from an `{{env.*}}` placeholder — and the runner enforces it rather than asking. A `fill` or `select` whose value appears in none of those is refused: it is not typed, the agent is told which sources it may draw from, and the step fails on the retry budget if it keeps insisting.

The rule used to live only in the prompt, and a prompt instructs rather than enforces. Run against a real model, `fill the note field` did not fail — the agent made a value up, filled it, and the step **passed**, producing "This is a test note." on two runs and "This is a new note" on a third. A test going green over a value nobody wrote, differing between runs, is worse than a failure.

A placeholder counts as a source **only when the step names that variable**. `fill the password field with {{env.TEST_PASSWORD}}` works; `fill the password field` does not become valid because the agent supplies `{{env.SOMETHING}}` itself. An agent cannot know the name of a variable nobody showed it, so one it produces is a guess — and a guessed variable would put a live credential into a field your test never pointed one at, in output that cannot redact a secret it was never told about.

Two limits worth knowing. A value the page shows in one format and the field wants in another — `1234` in the step, `1,234.00` in the box — is refused, and the fix is to write the value the way it is typed. And a very short value (`3`) appears somewhere in almost any page, so it will pass; this closes fabricated content, not every fabricated character.

`run` also warns about it first — the same rule caught earlier, from the test file, on every path, before launching a browser or asking for a key:

```
Authoring (a step enters a value but names none):
  Add a note (.blastproof/tests/notes.yaml) step 2:
      fill the note field
    → fill the note field with <value>
```

Non-fatal by default — `--fail-on-authoring` turns it into exit 1 for teams enforcing it in CI. Taking the value from the page is fine and is not flagged: `fill the recipient field with the address shown on the confirmation page`.

**The warning reads English only.** A suite written in another language runs exactly as well but is not inspected, and prints no warning saying so — silence from this check means "nothing found in English", never "this suite is clean". The runner's refusal has no such limit: it compares text rather than parsing grammar, so a suite in any language is still held to the rule at run time.

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
| `--fail-on-authoring` | Fail when a step enters a value but names none (warns by default) |
| `--junit [path]` · `--html [path]` | Write reports |
| `--concurrency <n>` | Run tests at once — [when that is safe](./docs/configuration.md#concurrency--running-tests-at-once) |
| `--write` | `plan` only — persist drafts instead of previewing |
| `--max-llm-calls` · `--max-tokens` · `--max-duration` | [Bound what a run may spend](./docs/configuration.md#budget--bounding-what-a-run-spends) |

Exit codes: **0** pass, **1** the gate failed, **2** usage or config error.

**Generated drafts are never executed and never affect the score.** An unreviewed model-written test in the merge path fails in two directions: a hallucinated expectation blocks a correct PR, and a credulous one waves a broken change through while looking like coverage. `plan` makes the gap visible with a draft to review; it does not make an uncovered route safe.

## Impact mapping

`--impacted` runs only the tests whose `routes:` intersect the routes your diff can affect, mapped from changed files by globs you maintain in `.blastproof/config.yaml`:

```yaml
routes:
  "src/cart/**": ["/cart", "/checkout"]
ignore:
  - "**/*.md"
```

The key is the file glob and the value is the routes it can affect — the opposite way round from a test file's own `routes:`, which is a plain list of the routes that test covers. Inverted, the map matches nothing at all and every run reports a diff that affected no page, so `blastproof` refuses a map written that way rather than running green against it.

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

**The verdict behind that number is pinned, and that is not the same as reproducible.** The model call that decides whether a step passed runs at temperature 0, so the same page and the same expectation are not re-sampled into a different answer — a gate that flips on identical input teaches people to re-run until green, which is worse than no gate. What pinning does not survive: provider-side batching, floating point, and a gateway routing two calls to different providers or quantizations. Expect far less variance, not a guarantee of the same output twice.

The calls that *choose* an action, and the one that drafts a test, are deliberately left free — that latitude is what re-resolves a control after a redesign instead of failing on it.

Wiring this into a pipeline, with the gating patterns worth knowing: [Running in CI](./docs/ci.md).

## Without a browser or a key

Half of blastproof is deterministic and free. These need no model, no browser and no network:

```bash
blastproof run --dry-run                              # what would run
blastproof run --impacted --dry-run                   # + which routes the diff touches
blastproof run --impacted --fail-on-unmapped --dry-run # + gate on unclassified files
blastproof plan --base main --dry-run                 # affected routes no test covers, no key needed
```

They report affected routes, files nobody has classified, and affected routes no test covers — a coverage-gap report with an exit code, useful even on a repo whose suite is Playwright or Cypress.

## Trust boundaries

The application under test is not trusted input: its page content reaches the model, so a page that controls its own accessible text can try to influence the agent. Two things constrain that.

**The agent cannot leave your application.** The boundary is `base_url`'s origin plus whatever `allowed_origins:` declares, and it constrains where the page **is**, not only where an action asked to go. A `navigate` outside it is refused before the request; a page that ends up outside it any other way — a redirect, a link to another host, a script setting the location — fails the step, and its content is never sent to the model. Enforced by comparison, not by asking the model nicely.

If your application legitimately spans hosts (an identity provider, a hosted payment step), declare them. A suite that was quietly walking onto a foreign page will now fail and name the origin to add.

**Your secrets stay out of prompts.** `{{env.*}}` placeholders survive intact and are substituted at the moment of typing. Every value your tests or auth recipe reference is redacted from everything else crossing into a prompt — page snapshots included — in literal and percent-encoded form. Redaction matches known values, so treat it as a strong default rather than a guarantee against a hostile app.

The system prompt also tells the model that page content is data, never instruction. That raises the cost of casual injection and is **not** a boundary — the origin constraint is. Do not point blastproof at an application you would not run locally.

## blastproof tests itself

The **Dogfood** badge is blastproof running against the demo app in this repo — real Chromium, real model, scored and gated, with public logs. It catches real regressions rather than diffing strings: change the demo discount from 20% to 5% while the page still claims *"20% off"* and it fails the step — that is the run in the GIF at the top of this page, verbatim.

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
