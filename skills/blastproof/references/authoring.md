# Writing a blastproof test

A blastproof test is plain English. That makes it easy to write and easy to write badly, and the difference is not stylistic — it decides whether the suite detects anything.

The measurement: an outside evaluation took **the same application, the same suite, the same version from Score 64 to Score 100 by rewriting two steps.** Nothing else changed. Two steps were worth 36 points.

## The canonical rules

These are quoted verbatim from `plannerSystemPrompt()` in `src/llm/prompts.ts`, which is the text the runner's own planner is given. They are reproduced here rather than paraphrased so the two copies can be compared mechanically; a test fails when they disagree. Do not reword them.

<!-- canonical:rules -->
- Write steps a human tester could follow without looking at the code. One move per step — a single action together with what it should produce, or a single check. Never two unrelated actions in one step.
- Refer to controls by the accessible name shown in the snapshot, spelled exactly. Never invent buttons, fields or links that are not in the snapshot.
- Never write CSS selectors, XPath, IDs or any code — the runner resolves elements live from the accessibility tree.
- **The test starts at the application's base URL, not at this route.**
- **Every step says what it should produce.**
- **A step that enters a value writes the value.**
- If a step needs a credential or any secret, write it as a placeholder like {{env.TEST_PASSWORD}}. Never write a real or invented password, token or key.
- Keep the whole test to a handful of steps: one journey, not an exhaustive suite.
<!-- /canonical:rules -->

Two of them need unpacking.

**The test starts at the base URL.** Every test begins by navigating, and the navigation step says what should be visible once the page loads: `navigate to /support and verify the heading "Contact support" is shown`. Without it the run opens the home page and every later step hunts for controls that are not there.

**Every step says what it should produce.** Name what must be true after the step, not the action alone:

```yaml
# Fragile — a bare action. Nothing says what should be true afterwards.
- submit the support form

# Robust — the step carries its own outcome.
- submit the support form and verify the confirmation page shows the ticket number
```

A bare action asks the runner to judge whether something happened while looking at the page that succeeding produces — a submitted form comes back empty, a redirect moves the URL. That ambiguity is the shape behind several real failures.

## What is enforced, and what is not

Being precise about this matters more than it looks. A rule you believe is checked, but is not, is worse than one you know is yours to keep.

| rule | enforced how |
|---|---|
| A step that enters a value writes the value | **Guaranteed by the runner.** A fill whose value is in neither the step nor the page is refused at run time. |
| A step that enters a value writes the value | Also warned at authoring time by a grammar check; `--fail-on-authoring` makes it exit 1. |
| Every step says what it should produce | **Not enforced.** Nothing fails when a step is a bare action. |
| A verification names an outcome only a correct page satisfies | **Not enforced.** See below. |

The authoring check reads **English only**. Silence from it means "nothing found in English", never "this suite is clean".

## A verification has to name something only a correct page can satisfy

This is guidance, not a rule the tool enforces, and it is the most common way a suite ends up worthless while reporting Score 100.

```yaml
# Worthless — satisfied by whatever the page happens to show.
- verify the totals are right
- verify the page looks correct
- verify it worked

# Worth having — a wrong page cannot satisfy these.
- verify the order total shows $96.00
- verify the heading "Order placed" is shown
- verify the notes list contains "Order update: customer called"
```

`verify the totals are right` has an object, so it looks like a real assertion. What it lacks is any statement of what *right* means, so the model judging it will find some reading of the page that qualifies. Measured against a demo shop, that step passed on an empty cart because `$0.00` is a defensible total.

The test to apply to each verification: **could a broken version of this feature also satisfy this sentence?** If yes, the step is decoration.

## The file

```yaml
summary: Applying a promo code updates the cart total
priority: P0                    # P0 | P1 | P2 — default P1. Weighs 3 / 2 / 1 in the score.
tags: [cart, checkout]          # optional, filterable with --tag
routes: ["/cart", "/checkout"]  # URLs this test covers; --impacted selects on these
auth: false                     # optional; a login test needs this
setup:                          # optional; runs before steps, fails the same way
  - navigate to /cart and verify the heading "Your cart" is shown
steps:
  - add the "Mechanical Keyboard" to the cart and verify it appears in the cart list
  - fill the promo code field with SAVE20
  - apply the promo code and verify the discount row shows -$24.00
```

Only `summary` and `steps` are required.

`routes:` compares by exact string equality — `/cart` and `/cart/` are different routes. A test declaring a route that no `routes:` mapping in `config.yaml` declares gets a warning, because it contributes nothing to `--impacted` selection.

Tests live in `.blastproof/tests/*.yaml`. Only `.yaml` and `.yml` are discovered, which is why templates ship as `.yaml.example`.

## Write tests in English

The runner executes a suite in any language equally well. The authoring check reads English only and stays silent on everything else — and prints no warning saying so. English keeps the check useful.
