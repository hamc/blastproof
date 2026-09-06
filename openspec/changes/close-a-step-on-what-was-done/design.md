# Design: close-a-step-on-what-was-done

## Context

The per-step loop asks the model for an action until one of them terminates the step. `done` terminates it unconditionally:

```ts
if (action.action === 'done') {
  emitAction(index, action, action.reasoning);
  break;
}
```

Nothing consults what happened first. The model's word that the step is finished *is* the step being finished.

Two things about the surrounding code make the fix small, and both were read rather than assumed:

**The executor already knows.** `StepRecovery.record()` is called at exactly one place — after `performAction` returns without throwing — so its history is precisely "what succeeded during this step". A failed click is not in it, which is the predicate this rule wants and not a new one to invent.

**A passing assertion never reaches `done`.** The `assert` branch breaks out of the loop the moment the judgment passes (that `break` is load-bearing; the comment on it records that turning it back into a `continue` is what let a model contradict its own passing assertion). So at the `done` branch, "nothing recorded" already means no action succeeded *and* no assertion passed. The rule needs no special case for verification steps.

## Goals / Non-Goals

**Goals:**
- A step that accomplished nothing cannot pass
- The rule is structural — no semantics, no second model call, no new state to keep in sync
- A model that legitimately finds the outcome already true can still close the step

**Non-Goals:** judging the *quality* of what was done, touching `judge()`, changing scoring, adding to the action vocabulary.

## Decisions

### D1: The predicate is "did anything succeed this step", and it already exists
`StepRecovery` gains a read-only accessor over the history it already keeps. No flag threaded through the loop, no counter that a future branch can forget to increment — the same reasoning that put the budget and the mask at one choke point each.

`iterations` is deliberately not the predicate. It counts turns taken, not work done: a step that proposes three actions and fails all three has three iterations and nothing accomplished, which is the case this rule exists for.

### D2: Refuse the attempt, do not fail the step outright
The `done` is not performed, the model is told why, and it costs one failed attempt. A model that keeps answering `done` therefore terminates on the existing retry budget with a clear reason, rather than grinding to the per-step iteration ceiling with an opaque one.

The precedent is the repeated-commit refusal in the same loop: the executor declining and explaining, counted as one attempt. Failing immediately was rejected because the first `done` is frequently recoverable — the model has often simply skipped emitting the assertion it meant to.

### D3: "Already satisfied" stays expressible, and the refusal is what teaches it
This is the decision the change lives or dies on.

A step can be legitimately finished with no action: *dismiss the cookie banner* against a page that has none. Under this rule the model may no longer say `done` and move on — and that is the point, because *"the promo code field does not exist, so this cannot be completed"* is the same sentence from the model's side.

The executor cannot tell those apart, and should not try. What it can do is require the model to **show** the outcome rather than **state** it: emit an assertion that the banner is absent, which the judge then decides against the page. Evidence instead of self-report.

So the refusal message is not a complaint, it is an instruction — the same standard `name-what-blocks-the-click` set. It says the step closed nothing, and that a step whose outcome already holds is closed by asserting that it holds.

The cost is one extra model call on a step that was genuinely a no-op. That is the price of the score meaning something.

### D4: A failed action does not count, and this needs no code
It falls out of D1: `record()` is only reached on success. Worth writing down because it is the property that makes the rule bite — a click that threw `Element not found` followed by `done` is exactly #76's reproduction, and it must not pass.

### D5: The rule applies to setup steps too
Setup steps run through the same loop and weigh on the same run. A setup step that accomplishes nothing and passes is worse than an ordinary one, because everything after it proceeds on a precondition that was never established.

## Rejected alternatives

- **Asking the model to confirm it acted** — a second call to answer a question the executor already has the answer to, and a self-report about a self-report
- **Requiring `fail` instead** — the model already had `fail` available and chose `done`; nothing in the vocabulary is missing, and a prompt asking harder is not a guarantee
- **A grammar rule in `authoring.ts` for steps that name an action without an outcome** — that is #44, it is a warning rather than a guarantee, and it cannot catch a well-formed step whose control has since disappeared from the page
- **Counting `iterations` instead of successes** — counts turns, not work (D1)
- **Failing the step on the first bare `done`** — removes a recovery the model usually takes (D2)

## Risks / Trade-offs

- **A genuinely empty step now costs a round trip.** The model must assert the outcome rather than assert its own completion. Intended, and it is a real cost on suites with defensive steps like "dismiss any banner".
- **A model that will not emit an assertion turns a passing step into a failing one.** That is the correct outcome by this change's own argument — the step never demonstrated anything — but it will be experienced as a regression by whoever was getting a green from it. This is the one thing to measure live before merging, and it is what task 4.2 is for.
- **Setup steps fail earlier and louder** (D5). Also intended, also a behaviour change.

## Migration Plan

No config, no flag, no file format. A suite whose steps act or assert is untouched — verified on the demo-app suite and two Juice Shop journeys, where no step closes on `done` with nothing recorded.

## Open Questions

- **Does a defensive step pattern exist in the wild often enough to matter?** "dismiss any cookie banner if present" is the shape at risk. Measured on our own suites it does not occur, but ours are eight tests written by two authors.
- **Should the report distinguish a refused `done` from other failures?** #13 is about the report saying what happened rather than only what failed, and this produces a new thing worth saying. Out of scope here.
