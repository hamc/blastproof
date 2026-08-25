---
name: blastproof
description: Use when setting up or writing end-to-end tests with blastproof — the plain-English YAML e2e runner that drives Chromium and resolves elements from the accessibility tree. Covers `blastproof init`, `plan`, `run`, `test`, the `.blastproof/` directory, config.yaml, impact mapping with routes:/ignore:, score gating, and writing or reviewing test steps. Trigger on "set up e2e tests", "add an e2e test", "blastproof", or any mention of `.blastproof/`.
license: MIT
metadata:
  author: blastproof
  version: "1.0"
---

# blastproof

blastproof runs end-to-end tests written as plain English in YAML. An agent drives a real Chromium and resolves every element from the **accessibility tree** by role and accessible name. There are no CSS selectors or XPath anywhere in the tool, and no fallback to them.

Read `references/authoring.md` before writing or editing any test — the rules there decide whether a suite is worth having. Read `references/cli.md` for commands, flags and exit codes, and `references/mapping.md` before touching `routes:` or `ignore:`.

## Operating rules

These are not style preferences. Each one exists because breaking it produces a suite that looks fine and is not.

1. **Generate tests from the running application, never from source code.** Use `blastproof plan` against the app, then edit what it produced. Writing a test by reading components produces a test that shares the code's misconceptions and passes for that reason — which is the failure this tool exists to catch.
2. **Never commit.** Present the files and the run result. The person decides what lands.
3. **A passing generated test is not evidence.** The model that wrote the assertion is the one that judged it. Read every step against `references/authoring.md` before believing a green run.
4. **Never write a credential into a test or into `config.yaml`.** Secrets come from the environment as `{{env.VAR}}` placeholders, and their values are masked everywhere blastproof prints.
5. **Do not configure authentication or CI.** Both are out of scope here; point at `docs/auth.md` and `docs/ci.md` in the blastproof repository and stop.

## Workflow

### 1. Check fit — before configuring anything

blastproof reaches only what the accessibility tree exposes. Scan the source first. This costs nothing: no config, no browser, no API key.

Look for:

- a `canvas` or an `iframe` carrying a primary flow
- click handlers on `div`, `span`, `li` or other non-interactive elements
- `input` elements with no `label`, `aria-label` or `aria-labelledby`
- buttons and links whose only content is an icon with no accessible name

**Canvas and iframe are structural.** No labelling reaches inside them. Say so, do not offer a repair, and stop — scaffold nothing.

**Everything else is repairable, and repairing it is the first task.** Report how many elements lack an accessible name and offer to give them one. This is a small, local, safe edit, and a misfit here is work rather than a rejection.

Be accurate about what an unnamed control costs. It does not always fail outright — the runner can fall back to matching literal text and sometimes gets there. What it does reliably is make the run expensive and unstable: measured against a page of `div` click handlers, one test took **219s and 15 model calls**, against **4–11s and 3 calls** for the same page with real `button` elements, and one element still failed to resolve. Repair it for cost and reliability, not because the page is otherwise untestable.

### 2. Choose a model provider

If `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is already set, use it and move on.

If neither is set, offer both paths and describe them accurately:

- **A hosted key** — Anthropic or OpenAI, or any OpenAI-compatible gateway through `llm.base_url`.
- **Ollama, running locally** — no per-run cost, and the page content never leaves the machine. State plainly that quality against this workload has not been measured, and that a model can advertise structured output support and still fail to produce a valid test draft. Do not present it as equivalent.

### 3. Scaffold

```
blastproof init
```

`init` writes fixed defaults and detects nothing, so three edits to `.blastproof/config.yaml` are always required:

- **`base_url`** — the address the app serves on, read from the project's dev server script. A port that happens to match the default is a coincidence, not a check.
- **`routes:`** — remove the whole block, **including the `routes:` key itself**. It maps `src/auth/**` and `src/cart/**`, examples from somebody else's project, and leaving them makes step 8 report on globs nobody chose. Removing only the entries leaves the key with no value, which fails config validation and exits 2.
- **`llm.provider` and `llm.api_key_env`** — set to whatever step 2 chose. `init` writes `provider: anthropic` and `api_key_env: ANTHROPIC_API_KEY`; leaving that in place on a machine holding only `OPENAI_API_KEY` fails at step 4 with a missing-key error, at the moment the workflow is trying to show the tool works. For OpenAI, `provider: openai` and `api_key_env: OPENAI_API_KEY`. For a local model, `provider: ollama` and no key at all.

```
blastproof run --dry-run
```

This proves the wiring — config parsed, tests discovered, routes resolved — without launching a browser or spending a model call.

No route-drift warning appears at this point, and its absence is not a signal: the check is skipped entirely while `routes:` declares nothing. It becomes live in step 8, where a mapping exists and a test can then declare a route the mapping does not cover.

Then install the browser, because nothing from step 4 onward works without it:

```
npx playwright install chromium
```

Chromium is not bundled. On a cold machine this download is the longest part of the whole setup. Skipping it produces a browser-launch failure at step 4 that looks unrelated to anything the workflow just did.

### 4. Confirm fit against the running application

Start the app, then:

```
blastproof plan --route <main route>
```

Without `--write`, this previews a draft and writes nothing. The draft is the evidence: a page whose accessibility tree exposes nothing produces a draft that says nothing.

This pass comes after scaffolding because `plan` needs `.blastproof/config.yaml` and a configured provider. The boundary being protected is *before any test is written*, not before configuration — scaffolding is cheap and reversible.

If the draft shows the application is not reachable after all, say so and say that `.blastproof/` can be deleted.

**Watch for a login wall.** `plan` snapshots whatever the browser lands on, and files the draft under the route you asked for regardless of where it ended up. So a draft that describes a sign-in page, for a route that is not the login route, means that route is behind authentication — the draft covers the login screen while claiming to cover the feature. Do not `--write` it. List the route in the step 9 hand-off instead.

### 5. Generate

```
blastproof plan --route <route> --write
```

**One route, unless the person named more.** Every other route the scan found goes into the step 9 hand-off as uncovered, not into a draft nobody asked for.

The reason is measured, not stylistic: of three drafts generated against a demo app, one asserted nothing and another asserted a cart total on a cart nothing had been added to. Both ran unedited and both scored 100. Drafts are worth having only in proportion to the curation spent on them, and curation is what runs out first.

`--write` never overwrites an existing file.

### 6. Curate — this is the step that matters

Read every generated step against `references/authoring.md`. This is fact-checking against the live page, not a read-through — nearly every non-trivial draft needs at least one correction. Drafts routinely contain:

- **assertions that are true of a broken feature.** The most common and the hardest to spot, because it looks specific. A generated cart test asserted `the discount is shown as -$0.00` and `the total is $0.00` — and never added an item to the cart. It passes. It would pass just as well with the discount logic deleted. Ask of every verification: *could a broken version of this feature also satisfy this sentence?*
- **action steps with no verify clause.** `enter a value in the promo code field` on a page that has no promo code field is closed as `done` — the model reports it cannot do it, and the step passes anyway. Every action step must name the outcome that proves it happened.
- steps that assert nothing, or whose assertion was truncated mid-sentence
- assertions about pages the planner never looked at, invented from context
- headings and messages quoted approximately — `"Cart"` where the page says `"Your cart"`
- paths that do not exist, taken from the route name rather than the app

Curate `app-load.yaml` too, or delete it. `init` scaffolds it with a single step — `verify the home page loads and shows a heading` — which is exactly the shape this reference calls worthless: a broken home page with any heading at all satisfies it. It is P1, so it weighs 2 in the score you are about to present.

Fix them, then run:

```
blastproof run
```

Present the test files and the result. Do not commit.

**When a step goes red, find out which of three things it is. Never a fourth.**

1. **The application is wrong.** Report it and leave the test alone — this is the tool working.
2. **The step is mis-authored** — a name that does not match the page, a path that does not exist, an assertion about a page the test never reached. Fix it against `references/authoring.md`.
3. **A control will not resolve.** Back to step 1: give it an accessible name.

Never the fourth: weakening the assertion until it passes. It is always available and always cheapest, and it converts a tool that found a defect into a suite that reports Score 100 over one. A test you have loosened is worth less than the red run you started with.

### 7. Record the accessibility contract

The project keeps being built after this. Without a written constraint the next screens arrive as unlabelled `div`s and the suite decays into red.

**Check for the marker first, in the target file only** — this skill's own text contains it too, so a repository-wide search always finds one. If it is already present in that file, replace everything between the markers and do not append. Either way, confirm afterwards that the file contains exactly one opening marker.

Otherwise append to the project's `AGENTS.md` — or `CLAUDE.md`, if that is what the project uses:

```markdown
<!-- blastproof:accessibility-contract -->
## Accessibility contract (required by the e2e suite)

The e2e tests resolve elements from the accessibility tree. Code that breaks
these makes its own feature untestable:

- Every interactive element carries an accessible name — visible text, `aria-label`, or a `<label>`.
- Use real `button`, `a`, `input` and `select` elements. Never a `div` with a click handler.
- Every form field has a label associated with it.
- No primary user flow lives on a `canvas` or inside an `iframe`.
<!-- /blastproof:accessibility-contract -->
```

**Ask before modifying a file you did not create.**

### 8. Seed the impact mapping

Read `references/mapping.md` before editing anything here. `routes:` is a **map keyed by file glob**, whose value is the routes that glob puts at risk — not a list of routes. The two are easy to swap and the CLI rejects the inverted form, so getting it backwards costs a round trip.

Map each glob to the routes its changes endanger, then close the loop:

```
blastproof run --impacted --fail-on-unmapped --dry-run
```

That reports every changed file no glob classifies. It needs no browser and no key. `--fail-on-unmapped` **requires** `--impacted` — on its own it exits 2, because without a diff there is nothing to classify.

`ignore:` has a boundary that matters when answering what it reports: the cheapest way to make this check green is the one that silences it permanently.

### 9. Hand off

Name what was deliberately left undone:

- Routes behind a login are untested. Authentication is configured by hand — <https://github.com/hamc/blastproof/blob/main/docs/auth.md>.
- No CI is wired up — <https://github.com/hamc/blastproof/blob/main/docs/ci.md>.
- Any route the scan found that no test covers yet.
