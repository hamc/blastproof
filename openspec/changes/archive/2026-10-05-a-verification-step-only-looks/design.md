# Design: a-verification-step-only-looks

## Context

**The defect, measured** (#139):

| probe | model | result |
| --- | --- | --- |
| demo app: *"verify the page says "Mechanical Keyboard added to cart.""*, clean browser | Haiku | PASS 3/3: `click "Add to cart"`, then `assert :: ok` |
| same | Luna | PASS 3/3: `click "Add to cart"`, then `done`, with no judgment |
| Juice Shop: *"verify the basket shows exactly 7 items"* while it shows 6 | Luna | PASS 3/3, and the database basket went from 6 to 7 each time |
| same, QA pass before 0.23.0 | Haiku | 1/4 clicked, the step failed anyway |
| demo app: *"verify the cart lists "Mechanical Keyboard""* on `/cart`, where no button adds it | both | FAIL 6/6, correct |

A verification about notes also fails 6/6, but only because adding a note requires typing a value, which `refuse-an-invented-value` refuses. A write that needs no value has no guard.

**Why the executor cannot refuse it now.** Every refusal it makes is structural: a repeated commit, a typed redaction label, a value the step and the page never showed. None of them asks what the step *means*. `close-a-step-on-what-was-done` made that a principle (#72): the `done` rule was generalised to "something succeeded in this step" so that verification steps needed no separate case. That generalisation is exactly what lets a click then `done` close a verification.

**What the steps look like.** I took every step in the repository and the probes: the dogfood suite, the QA probes, the judge corpus and the authoring reference's examples. Of 82 distinct steps, 26 begin with `verify` or `check`, and all 26 are pure checks. The planner is told *"One move per step — a single action together with what it should produce, or a single check"*. A check is written as *verify …*, and an action that needs checking is written *"submit the form and verify …"*, which begins with its action.

**In the run logs** kept in this investigation, steps beginning with a verification verb ran 94 times. A click or committing press happened in 11 of those runs: 9 were false PASSes, 1 a click on a navigation link and 1 an add that left the step failing anyway. No run shows a verification step that needed a click to pass honestly.

## Goals / Non-Goals

**Goals:** a verification step cannot change the application, and cannot close on the agent's word.

**Non-Goals:** steps in other languages, over-acting inside action steps, action steps closed on `done`.

## Decisions

### D1: A verification step is recognised by its first word
`isVerificationStep(step)` in `src/runner/authoring.ts`, beside the grammar that is already there. It is true when the step, after an optional leading `then` or `and`, begins with `verify`, `check`, `confirm`, `ensure`, `assert`, `expect`, `validate`, `make sure` or `see that`. Case does not matter.

Only the first word counts. *"Click Add to cart and verify the status says…"* begins with its action and stays an action step. That is how the authoring rule and the planner already write steps, so this classifier is not a new convention imposed on authors, just the existing one read.

**Why grammar, after #72 rejected semantics.** #72's objection was that a cheap approximation of a *content* check can be satisfied by rewording, which turns "unknown" into "falsely reassured". Here the error runs the other way.
- A step misclassified as a verification gets a refused click, which the step reports as a visible failure with a message naming the rule.
- A verification step missed by the rule, in another language or phrased differently, behaves exactly as today.

Neither direction produces a new false PASS. Rewording is no threat either: the step's author is the one being protected, and the agent cannot reword the step it is given.

### D2: Refused like any other refusal
`StepRecovery.refusalFor` gains a check, ahead of the others: in a verification step, a `click`, or a `press` of a committing key (the same set `contained-recovery` uses), is refused. Like every refusal, it costs one attempt, so a model that insists ends on the retry budget. The message:

> refused: this step only verifies — it does not ask you to change anything, so clicking or pressing here could make the check pass by producing what it checks. Assert what the page shows. If what the step names is on another page, navigate there. If it is not shown, fail the step.

`navigate` stays allowed. It is a GET, and the most likely legitimate move in a check: *"verify the cart lists X"* may need `/cart`. A link click is refused even though it is usually a GET, because the executor cannot tell a link from a logout menuitem, and `navigate` covers the need.

### D3: `done` never closes a verification step
In a verification step, `done` is refused, whatever succeeded before it, with the existing message's advice: assert that it holds. The judgment's passing `break` stays the only way such a step closes. The rule sits beside the existing `recovery.acted` check in the executor. A verification can no longer close on the model's own sentence, and `close-a-step-on-what-was-done`'s rule for every other step is unchanged.

### D4: The model is told, and so is the author
The executor's system prompt gets one sentence: a step that begins with *verify* or *check* only looks. Assert, navigate or fail; never click or press. The refusal is what enforces it; the sentence saves the attempts. The authoring reference gains a row in its table of what is enforced, and the advice to name the action that reveals hidden content (*"open the Account menu and verify it shows…"*).

## Rejected alternatives

- **The judge classifies the step**, with a field saying whether the step asks for an action, and code fails a PASS after a commit in a step that asks for none. It works in any language. But it puts a guarantee on a model's reading, the reading #129 shows varying between models, and it does nothing for `done`, which never reaches the judge. Not measured.
- **Every step closes on a judgment.** That would close mechanism 2 for every step, at the cost of a judge call for every fill closed on `done` today, and it reverses `close-a-step-on-what-was-done`'s choice to let an action step close on what it did, with no measured need outside verification steps.

## Risks / Trade-offs

- **[A legitimate verification needing a click now fails.]** For example, *"verify the Account menu shows the email"* with the menu closed. None appears in our 82 steps or 94 runs, and the refusal says what to write instead. Accepted, for the asymmetry in D1.
- **[English only.]** As the authoring check is. A suite in another language keeps today's behaviour, including #139.
