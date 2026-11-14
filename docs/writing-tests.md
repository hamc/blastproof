# Writing tests

What decides whether a suite works: markup the agent can read, steps that say what they should produce, values the step writes down, and data you can throw away. Back to the [README](../README.md).

## The test file

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

`priority` is P0–P2 (default P1). `tags`, `setup` steps, `auth` and `device` are optional — `auth: false` runs the test signed out, which a login test needs, and a selection in which *every* test declares it skips the login altogether. `device: Pixel 7` runs the test as a phone from [Playwright's device list](./configuration.md#device), so a responsive app's mobile interface can be tested beside its desktop one. `routes` declares the URLs a test covers, which is what `--impacted` selects on; write route strings consistently, since they compare by exact equality (`/cart` ≠ `/cart/`). `run` warns to stderr — non-fatal — when a test declares a route no `routes:` mapping declares, since that route contributes nothing to `--impacted` selection.

## Say what each step should produce

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

Since 0.33.0 the runner covers the commonest form of this for you: an action step that names no outcome, followed directly by a check, is judged on that check. The agent still reads only the step you wrote, and the judge decides it as one sentence (`submit the add-task form and verify the new task …`), both when the agent says it is done and once more before the step would fail. The agent is never shown the check, because an agent that knows what the test wants to see can produce it: told the check, both reference models clicked "Add to cart" on a shop page to make a false check pass. The report still shows both steps as you wrote them, and the check still runs. On this repository's notes page, the split form went from 0 passes in 10 to 10 in 10 on Haiku. The join reads English check verbs only, and it does nothing for an action followed by another action, or for a last step that acts and checks nothing.

Write steps that end in an observable result — text on the page, a count, a state change — and this class of failure does not arise.

**Inline error messages should be plain visible text.** `role="alert"` is read correctly from the accessibility tree and needs no special handling, but note that an alert your page has cleared shows up as an empty element: if a verdict says an alert exists whose content is missing, the message was emptied, not hidden.

## A step that enters a value writes the value

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

## Does this fit your application?

Three questions. The first one decides most cases.

## Is your markup accessible?

**A hard requirement, not a preference.** blastproof finds elements the way a screen reader does — by role, by label, by visible text. That is what removes selectors and survives redesigns. The cost is that there is deliberately no CSS or XPath fallback, so anything the accessibility tree cannot describe cannot be driven at all.

The agent acts on the element it read, not on a search for its name. Each element in the snapshot it reads carries a ref, and an action names that ref: two controls called `Delete` are two different targets, and `Add` is never mistaken for `Add New`. If the role and name the agent gives do not match the element the ref points at, the action is refused rather than performed. A ref is valid only for the snapshot it came from, so nothing like a selector is ever stored.

| works | cannot be driven |
| --- | --- |
| `<button>Add to cart</button>` | a `<div>` with a click handler |
| `<label for="email">` + `<input>` | an input with no label |
| `<button aria-label="Delete note">` | an icon-only button with no name |
| `<select>` with `<option>`s | an ARIA-less custom dropdown |

**An editable data grid needs one cell per step.** On a budgeting app's transaction register, a new row shows only the cell that has focus. The date input appears as `textbox [active]: 10/12/2026`, with no name. The empty payee and notes cells are plain `div`s, and the accessibility tree drops them. Each cell becomes a named input only once it is focused. A step asking for four values at once shows the agent one textbox, and it typed the payee into the date. Written one cell per step in keyboard order, the same journey passed:

```yaml
  - click "Add New" and verify a new transaction row is open with its date field focused
  - press Tab to move to the payee field, type Fast Internet, and choose "Fast Internet" from the suggestions
  - press Tab three times to move to the payment field, type 12.34, and click "Add"
```

That test failed 3 runs of 3 written as one step, and passed 3 of 3 written this way, on 0.26.0 with `claude-haiku-5.5`. On the app's side, a label on each cell's input makes the one-step version readable too. If your core journey is a row editor, spend one test on it before adopting ([#67](https://github.com/hamc/blastproof/issues/67)).

**Run an accessibility checker on your app before installing anything.** The result predicts how well this will work better than anything else you could measure — and the fixes it suggests are worth making regardless of whether you adopt this tool.

## Does your journey need anything on this list?

Not supported yet:

- **scroll-to, drag and drop, file upload**
- **multiple tabs**, and native `alert` / `confirm` dialogs

**Windows is untested.** Development and CI run on Linux and macOS. Nothing is known to be broken and reports are welcome ([#8](https://github.com/hamc/blastproof/issues/8)).

If a critical journey needs one of these, that journey stays with your existing test suite. The two can coexist — nothing here replaces what you already have.

## Can you point it at data you can throw away?

**Use a seeded database, a staging environment you can reset, or a throwaway account. Do not gate on a run against production data.**

Within a step, an action that commits — a click, or pressing Enter — is not performed twice: the runner refuses the repeat and tells the agent it already did that. This closes the case that used to produce duplicate records, where a submit answered by a redirect came back to a reset form and the agent, seeing no evidence of its own work, refilled it and submitted again. One repeat goes through: the same control pressed again right after itself, with nothing else done in between, when the page changed after the last press — a tour's "Next", a wizard, "load more". A form that came back empty is not that case: when a field that held a value before the press is on the page again with no value, the repeat is refused.

A key press counts as the click it stands for. Enter or Space on a button is that button's click, and Enter in a field of a form is the click of the form's submit button, which the runner asks the browser for. So a form submitted by its button is not submitted again with Enter, or the other way round. Enter in a field that was not on the page when the button was last pressed goes through when the fields that page had are gone: that is the next page of a form, like a sign-in that asks for the email and then the password.

Two steps this refuses that are not duplicates, both visible in the report as a refusal: a wizard whose next page has a field of the same name as one you filled, left empty, with "Next" pressed twice in a row; and Enter in a field that handles the key itself (a tag input, an autocomplete) after the form's button was already clicked and something else was done since. Split such a step in two.

It is **not** a guarantee of zero duplicate writes. An agent that reaches the same effect by a genuinely different route — another button that does the same thing, Enter in a form built without a `<form>` element, or Enter in a field whose own script sends the form — is not caught.
