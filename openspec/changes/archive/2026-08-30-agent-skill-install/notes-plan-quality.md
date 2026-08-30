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

1. **#74** — `plan --write` does not create `.blastproof/tests/`. `writeDraft`
   (`src/planner.ts:152`) handles `EEXIST` but not `ENOENT`, and the raw Node
   error with an absolute path reaches the user — below the standard `AGENTS.md`
   sets for the prerequisite boundary.
2. **#75** — a write failure aborts the whole run. The draft already generated for an
   earlier route is discarded and its model calls are spent for nothing.
3. **#72** — a step whose verification has no object passes both the authoring
   check and the runner.

## Cost

~63k tokens across four `plan` and `run` invocations, about **US$0.01** at
flash-lite pricing. One route costs 15 model calls including the login journey.
This is one tiny static app and one cheap model; it is a floor, not a figure to
quote.

---

# Adversarial QA of the written skill (task 7)

A separate reviewer with no context followed the skill literally against the demo
app and tried to break it. Eight findings; six were accepted and fixed, two were
overstated and corrected in a different direction than proposed.

## The one that is a product defect, not a skill defect

A step that names an action but no outcome, against a control that does not
exist, is closed as `done` and the test passes:

```
step 2/2: enter a value in the promo code field
    -> done :: The current page does not contain a promo code field, so this
               step cannot be completed.

PASS    P0    Score: 100
```

Reproduced independently. The model states in plain text that it could not carry
out the step, and the runner accepts `done` anyway. The `fail` action exists and
the model did not choose it.

Filed as **#76**. **This generalises the fix deferred on #72 and makes it worth more.** The rule
under discussion there — a verification may not close on `done` having emitted no
assertion — is the same rule this needs: *a step may not close on `done` having
emitted no action at all*. One structural check, no semantics, covering both
shapes. Worth a separate issue and worth reconsidering the deferral.

## Corrected, rather than accepted as reported

**"Unnamed controls block resolution" was wrong in our own text.** They do not
block it — the runner falls back to matching literal text and often gets there.
What they do is make the run expensive and unstable: 219s and 15 model calls
against a page of `div` click handlers, versus 4–11s and 3 calls for the same
page with real buttons, plus one element that still failed to resolve. The skill
now states the cost, not a false absolute.

**The canonical rules block was claimed to be something it is not.** It said
"quoted verbatim … so the two copies can be compared mechanically" while
silently omitting a planner-only rule and truncating the bolded rules to their
lead sentence. Both omissions are deliberate and defensible; the claim around
them was not. The text now says exactly what is quoted, what is left out, and
what the test does and does not enforce.

## Fixed in the skill

- The workflow never told anyone to install Chromium — it lived only in the CLI
  reference. On a cold machine that is the longest step in the whole setup.
- `init` writes a fixed `base_url` and detects nothing; the skill implied
  otherwise.
- Step 6 gained the two failure shapes the QA reproduced: an assertion true of a
  broken feature (a cart test asserting `-$0.00` that never adds an item), and an
  action step with no verify clause. Both had been described only in
  `authoring.md`, which an agent working from the workflow can skip.
- Step 7 led with "append" and buried the idempotency rule after the code block.
  It now checks for the marker first and verifies one block afterwards.
- `cli.md` had `--junit <path>` and `--html <path>` as required; both are
  optional with defaults. `--tag` is repeatable and did not say so.

## Timing

Server start to first green run, following the workflow: **~119s**, with an API
key already set and Chromium already cached. Chromium's download is not in that
number and dominates a cold machine. Curation is real work — nearly every
non-trivial draft needed at least one correction against the live page.
