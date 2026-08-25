# Measurement: `plan` draft quality (tasks 1.1–1.3)

Run on 2026-08-25 against `examples/demo-app` on `http://localhost:4173`.
Provider: OpenRouter (`provider: openai`, `base_url: https://openrouter.ai/api/v1`).
Config overrides passed by environment; the committed `.blastproof/config.yaml`
was not modified. Drafts were written into a scratch directory, not the repo.

## Model compatibility

| Model | Executor schema | Planner schema |
|---|---|---|
| `deepseek/deepseek-v4-flash-0731` | passes | **fails** — `No object generated: could not parse the response` |
| `deepseek/deepseek-v3.2` | **fails** — `response did not match schema`, retry budget exhausted | not reached |
| `google/gemini-2.5-flash-lite` | passes | passes |

`generatedTestSchema` is four fields — a string, a string array, a three-value
enum and a string array. Nothing about it is unusual, so the failures are model
conformance, not schema complexity. A direct probe of `v4-flash-0731` against a
two-field strict schema returned an object missing a required field, which is
consistent with what the planner saw.

**Advertising `structured_outputs` in a provider catalogue does not mean a model
satisfies a strict schema.** Any statement the skill makes about cheap or local
models has to survive this, and today it would not.

## Drafts produced (`gemini-2.5-flash-lite`)

`/` — preview only. Correct shape: outcome-carrying steps, sensible priority,
tags and routes. Two invented facts about a page the planner never snapshotted:
a cart count that the accessibility tree does not expose, and the cart heading
given as `Cart` when the page says `Your cart`.

`/notes.html` — usable after edits. Navigates to `/notes` when the route is
`/notes.html`; step 3 clicks `Add note` a second time after step 2 already
clicked it, then asserts a count of 1.

`/cart.html` — unusable. The single step is truncated mid-sentence:
`navigate to /cart.html and verify the heading ` — naming no heading at all.

## The result that matters

Both persisted drafts were run unedited. **Both passed. Score: 100.**

The `cart.html` pass is a false green of the purest kind: the step names no
heading, so the runner chose one — it asserted `Your cart` and then judged that
assertion true. A step that asserts nothing was graded by the model that filled
in what it should have asserted.

`--fail-on-authoring` does not catch it. The authoring check looks for a step
that enters a value without naming the value; a *verification* with no object is
not in its grammar, so the step passes the check and then passes the run.

**So pass rate is the wrong acceptance criterion for task 1.** A generated test
that passes is not evidence: the same model wrote the assertion and judged it.
Task 1.2 as written ("how many pass unedited") measures agreement between a
model and itself. It needs replacing with a criterion a human applies — does
each step name a control and an outcome that exist on the page.

## Defects found

1. `plan --write` does not create `.blastproof/tests/`. `writeDraft`
   (`src/planner.ts:152`) handles `EEXIST` but not `ENOENT`, and the raw Node
   error with an absolute path reaches the user — below the standard `AGENTS.md`
   sets for the prerequisite boundary.
2. A write failure aborts the whole run. The draft already generated for an
   earlier route is discarded and its model calls are spent for nothing.
3. A step whose verification has no object passes both the authoring check and
   the runner.

## Cost

~63k tokens across four `plan` and `run` invocations, about **US$0.01** at
flash-lite pricing. One route costs 15 model calls including the login journey.
This is one tiny static app and one cheap model; it is a floor, not a figure to
quote.
