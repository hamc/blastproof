# Proposal: match-the-name-the-model-named

## Why

`prompts.ts` tells the executor to pick targets "using their exact role and accessible name". `actions.ts` then matches that name by **substring, case-insensitively**, and when several elements match it takes `.first()` in DOM order without telling anyone (#60).

The model is not the problem here — it did what it was told. This is the same shape as #57 and #72: a rule stated in a prompt and quietly widened by the code beneath it.

The loud failures are the lucky ones. The unlucky one is a substring that resolves to the wrong control and the action **succeeds** on it: the run then reports a verdict about a control nobody targeted, and nothing in the report can say so, because nothing knows.

## What Changes

- Resolution asks for the **exact** accessible name first and falls back to today's substring match only when the exact one finds nothing, so a page that offers a unique name is driven by it
- ~~Refusing an ambiguous name instead of letting `.first()` choose in silence.~~ **Cut before implementation, by this change's own gate.** Measured on real accessible sites, the refusal refuses ordinary navigation: on gov.uk, 22 accessible names are shared between a visible control and a screen-reader twin that Playwright counts as visible. `.first()` still resolves by document order, and that half of #60 stays open. The design carries the measurement and the reasoning the next attempt has to beat
- The README stops promising "by role, by label, by visible text" without saying how the name is compared

## Capabilities

### Modified Capabilities

- `agentic-execution`: live element resolution prefers an exact accessible-name match, and refuses an ambiguous one rather than guessing

## Impact

- New dependencies: **none**
- Affects: `resolveTarget` in `src/runner/actions.ts`, the `PageLike`/`LocatorLike` interfaces it resolves through, the four test files implementing them, and `README.md`
- **This changes element resolution for every existing suite.** The fallback chain is what keeps it from being a regression: a step that works today because the loose match found the only candidate still works
- Interfaces widen by one optional flag; `count()` and `filter()` are not needed, because the refusal was cut

## Known limit, measured

Resolution knows two things about a target: its role and its accessible name. Two controls sharing both are indistinguishable here, and every answer available to a matcher over that pair is either a guess or a refusal. Refusing was designed, then measured, then cut — the `.sr-only` pattern keeps a real box, so a screen-reader twin counts as visible and ordinary links become "ambiguous". The way out is not a better rule over two signals; it is more signals, and that is a change of its own.

## Non-goals

- **No fix for the two Actual Budget witnesses in #60.** Stated plainly because the issue implies otherwise: a step naming `Create` where the page offers only `Create a local account` still falls back and still resolves it, and a `Payee` column header that is the only button with that name is still the exact match. Neither is a matching bug — the page has no unique name for the thing the model wants, and no matching rule can invent one. What this change fixes is the case where a unique name **does** exist and loses to a longer one, and the case where several controls share a name and one is picked silently
- **No CSS or XPath fallback.** The absence of one is the product
- **No normalization** of whitespace, case or truncation beyond what Playwright's exact match already does
- **No change to the prompt.** The instruction was already right — the refusal message is where the rule is repeated, because that is where the model is listening
- **No widening of what the resolver knows about a target.** Position, structure and appearance would dissolve most ambiguity and are a change of their own
