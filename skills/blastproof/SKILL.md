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

Then set `base_url` in `.blastproof/config.yaml` to the address the app serves on. Read it from the project's dev server script — `init` writes a fixed default and does not detect anything, so a port that happens to match is a coincidence, not a check.

```
blastproof run --dry-run
```

This proves the wiring — config parsed, tests discovered, routes resolved — without launching a browser or spending a model call.

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

### 5. Generate

```
blastproof plan --route <route> --write
```

One route at a time, for the primary journeys. `--write` never overwrites an existing file.

### 6. Curate — this is the step that matters

Read every generated step against `references/authoring.md`. This is fact-checking against the live page, not a read-through — nearly every non-trivial draft needs at least one correction. Drafts routinely contain:

- **assertions that are true of a broken feature.** The most common and the hardest to spot, because it looks specific. A generated cart test asserted `the discount is shown as -$0.00` and `the total is $0.00` — and never added an item to the cart. It passes. It would pass just as well with the discount logic deleted. Ask of every verification: *could a broken version of this feature also satisfy this sentence?*
- **action steps with no verify clause.** `enter a value in the promo code field` on a page that has no promo code field is closed as `done` — the model reports it cannot do it, and the step passes anyway. Every action step must name the outcome that proves it happened.
- steps that assert nothing, or whose assertion was truncated mid-sentence
- assertions about pages the planner never looked at, invented from context
- headings and messages quoted approximately — `"Cart"` where the page says `"Your cart"`
- paths that do not exist, taken from the route name rather than the app

Fix them, then run:

```
blastproof run
```

Present the test files and the result. Do not commit.

### 7. Record the accessibility contract

The project keeps being built after this. Without a written constraint the next screens arrive as unlabelled `div`s and the suite decays into red.

**Check for the marker first.** If `<!-- blastproof:accessibility-contract -->` is already present, replace everything between the markers and stop — never append a second copy. Afterwards, confirm the file contains exactly one opening marker.

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

Add the routes the tests cover to `routes:` in `.blastproof/config.yaml`. Read `references/mapping.md` first — `ignore:` has a boundary that matters, and getting it wrong silences the check permanently.

### 9. Hand off

Name what was deliberately left undone:

- Routes behind a login are untested. Authentication is configured by hand — `docs/auth.md`.
- No CI is wired up — `docs/ci.md`.
- Any route the scan found that no test covers yet.
