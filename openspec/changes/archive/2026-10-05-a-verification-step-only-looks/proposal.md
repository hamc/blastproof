# Proposal: a-verification-step-only-looks

## Why

A step that only verifies something false can be made true by the agent (#139). On `examples/demo-app`, in a clean browser:

```yaml
- verify the page says "Mechanical Keyboard added to cart."
```

Both reference models clicked "Add to cart" and the step passed, 3/3 each. Haiku's judge then saw the message. Luna closed the step on `done`, with no judgment at all. On OWASP Juice Shop, *"verify the basket shows exactly 7 items"* was run while it showed 6. Luna added an item, the database went from 6 to 7, and the step passed 3/3. A gate that lets the agent repair the page it checks hides the bug the check is for.

The executor cannot refuse this today, because nothing in it knows that a step asks for a check rather than an action. `close-a-step-on-what-was-done` chose a structural rule with no semantics (#72), and its cost is now measured.

## What Changes

- A step whose first word is `verify`, `check`, `confirm`, `ensure`, `assert`, `expect` or `validate`, or `make sure` or `see that`, optionally after `then` or `and`, SHALL be a **verification step**. English only, like the authoring check.
- In a verification step, a `click` or a committing `press` SHALL be refused, with a message saying the step only looks: assert what the page shows, navigate if the thing is elsewhere, or fail. `navigate`, `assert` and `fail` stay allowed.
- A verification step SHALL close only on a passing judgment. `done` is refused in it.
- `skills/blastproof/references/authoring.md` SHALL state the rule. A check that needs a menu opened first names that action (*"open the Account menu and verify it shows…"*).

Measured on every step we have (82 distinct, from the dogfood suite, the QA probes, the judge corpus and the authoring reference), 26 are verification steps by this rule, and every one is a pure check. In our run logs, verification steps ran 94 times. 11 of those runs contained a click: 9 ended in a false PASS, and 2 failed anyway. None was a click the step needed.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: a verification step may not commit, and closes only on a judgment

## Impact

- Dependencies: **none**
- Affects `src/runner/authoring.ts` (the classifier, beside the existing grammar), `src/runner/recovery.ts` (the refusal), `src/runner/executor.ts` (`done`), `src/llm/prompts.ts` (the executor is told), the authoring reference, and their tests
- **Behaviour change.** A verification step that used to click its way to a PASS now fails. That is the point, but a suite that relied on it, unknowingly, turns red

## Non-goals

- **Steps in other languages**: they match nothing and behave as today
- **Over-acting in action steps**, for example clicking the cookie banner in a step about the Welcome banner (#120, shape 2). That step asks for an action, so this rule cannot tell which ones are wanted
- **An action step closed on `done` without judging its stated outcome**, a separate gap in `close-a-step-on-what-was-done`
