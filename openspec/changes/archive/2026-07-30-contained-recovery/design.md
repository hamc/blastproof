## Context

The per-step loop in `src/runner/executor.ts` is:

```
settle → snapshot → brain.nextAction({ step, snapshot, lastResult, budgets }) → perform → repeat
```

`lastResult` is the only memory the model has. Everything else it knows, it re-derives from the current snapshot every turn.

That is fine while a step moves forward, because the snapshot reflects the progress. It breaks the moment an action's effect is invisible in the snapshot that follows it. The canonical case:

1. `click button "Add task"` → ok
2. `POST /api/tasks` → 600ms → `302 /tasks`
3. the snapshot shows `/tasks` with an **empty** add-task form
4. the judge decides the step's outcome does not hold
5. the model is asked what to do next, and sees: a form, empty, and a stale `lastResult`

At step 5 the model is in a state it cannot distinguish from "the click never happened". Filling the field and clicking submit is the *correct* inference from the evidence it was given. The evidence is just incomplete — the executor performed that click and knows it.

## Goals / Non-Goals

**Goals:**
- A step cannot re-perform a commit it already performed.
- The model recovers with the step's own history in view.
- A failing test costs a failed run, not extra rows.

**Non-Goals:**
- Deciding which actions mutate. Undecidable from the accessibility tree.
- Guaranteeing zero duplicate writes in all shapes. See "Residual risk".
- Changing the retry budget's size or the judge's behaviour.

## Decisions

### D1 — Refuse a repeated commit, in the executor

**Decision.** The executor keeps, per step, the set of actions that have been performed **successfully** in that step. An incoming `click`, or a `press` of a key that activates a control, whose identity matches a member of that set is **not performed**. The refusal becomes that turn's `lastResult` and counts as one failed attempt.

**This decision was scoped to recovery first, and the reproduction disproved it.** The original version refused a repeat only after a judgment in the step had already failed — on the reasoning that before a failure there is no blast radius to contain, and a step may legitimately click the same button twice. It was implemented, unit-tested, and then run against the demo-app reproduction, which produced:

```
step 3/4: submit the add-note form
  -> click button "Add note" :: ok
  -> fill textbox "Note" [Test note] :: ok
  -> click button "Add note" :: ok
  -> assert :: ok: assertion passed
```

No judgment failed anywhere in that step. The model saw a reset form, re-filled it with an invented value, and submitted again entirely on its own initiative — and the duplicate note was written exactly as before. **The trigger is not a failed judgment.** It is a page that has lost the evidence of what was done to it, which the model re-reads as an untouched page whether or not anyone judged it. The condition was removed and the guarantee now covers the whole step.

**What that costs.** A step that legitimately needs the same commit twice loses the second one. Two things make this acceptable. Our own authoring guidance already says one action per step — it is in the planner's prompt verbatim ("One action or check per step") — so a step needing two identical commits is contradicting the format we document. And a genuine retry, where the commit landed but had no effect, is refused too: that case is *indistinguishable* from a commit whose evidence a redirect erased, since both produce the same snapshot. The asymmetry decides it. A refused legitimate retry costs a visible failed step someone investigates; an allowed duplicate commit costs a silent extra row in someone's database.

**Identity** is `action` + `target.role` + `target.name` + `target.text` + the **unresolved** `value`. Unresolved matters: `{{env.TEST_PASSWORD}}` must compare as itself, never as the secret it expands to, so the record never holds a substituted credential.

**Why this and not a mutation classifier.** #28 asks whether the executor can tell an observing action from a mutating one. It cannot — no property of a role and an accessible name says whether a button writes to a database, and a classifier that guessed would be wrong in both directions: it would let real writes through and block harmless retries. Repetition, unlike mutation, is fully decidable from what the executor already has in hand. The bet this change makes is that **in the shapes that actually hurt, the mutation happens through a repeat**, and both reproductions support it:

| | recovery actions | the one that writes |
|---|---|---|
| Gitea | `click "New Issue"` (new) → `click "Create Issue"` | the repeat |
| TaskBoard | `fill subject "New Task"` (new) → `click "Add task"` | the repeat |

In both, the differing action only restores the preconditions; the commit is verbatim. The issue body claimed a repeat guard would not catch the Gitea shape "which is three different actions" — re-reading the transcript, that was wrong, and correcting it is what made this design tractable.

**Why `click`, and `press` only for keys that activate.** These are the commit actions — the point where a side effect lands. `fill` and `select` populate controls; they become an effect only when something commits them, and refusing a repeated `fill` would block the legitimate re-typing that a reset form genuinely requires. `navigate` is a GET whose entire effect is visible in the very next snapshot, and refusing it removes the model's only way to restore preconditions while protecting nothing. `assert` never mutates by definition.

Guarding *every* `press` was the first attempt and it was wrong: it broke an existing test that walks a page with six repeated `Tab` presses — precisely the legitimate repetition this must not touch. `Enter` submits and space activates a focused button; `Tab`, `Escape` and the arrow keys move focus or dismiss. Only the first group commits. That an existing test caught it is the argument for keeping it.

**Why a refusal rather than an error.** A refused action is not a malformed response and not a browser failure; it is the executor declining. Returning it as the result keeps the model in the loop with an explanation ("you already did this in this step; it was not repeated") instead of failing the step outright, which would trade duplicate writes for false failures. It counts as one failed attempt so that a model insisting on the same action still terminates on the existing budget of 3 rather than grinding to the 15-action ceiling.

### D2 — Show the model what it has already done in this step

**Decision.** `AgentIterationInput` gains the list of actions already performed successfully in the current step, each with its result, rendered into `agentUserPrompt` above the snapshot. It resets at every step boundary.

**Why.** This is the root cause, and D1 without it is a guard against a symptom: the model would be refused without ever learning why its inference was wrong, and would keep proposing variations. With the history in view, "I clicked Add task and it succeeded" is available at exactly the turn where the empty form would otherwise read as an untouched one.

**Why the step and not the test.** Cross-step history is the test's own narrative, already encoded in the ordered steps; carrying it would grow every prompt for no decision it changes. The failure is intra-step.

**Known risk.** An action transcript was threaded into a prompt once before, in `src/auth.ts`, and it broke working logins — the model read the transcript as instructions about what to do rather than as a record of what it had done. That was the *judge's* prompt and a differently shaped input, but the risk class is the same, so: the rendering must be plainly labelled as history, and the login journey must be verified against a real model before this ships. Unit tests did not catch that regression and will not catch this one.

### D3 — Do not invent a field value (supporting, not load-bearing)

**Decision.** `agentSystemPrompt` gains a rule: use only values the step supplies, values already on the page, or an `{{env.*}}` placeholder — never a value of your own devising; if a step needs a value it does not give, that is a failing step, not a gap to fill.

**Why it is only supporting.** DEF-005 records that this project reaches for a prompt clause too readily and that the structural lever should come first. D1 and D2 are that lever, and both reproductions' writes are stopped by D1 alone. This clause exists because inventing input is a distinct harm from repeating one's own — `New Task` was in no test file — and because the planner prompt already forbids inventing *elements* (`Never invent CSS selectors or guess elements not in the snapshot`), so this extends a rule that is already there rather than introducing a new species of instruction. It is not relied upon: if it is ignored, D1 still holds.

**And it was ignored.** In the verification run the model, with this clause in its system prompt, still filled the note field with `Test note` — a value from nowhere. The fill was harmless because D1 refused the commit that would have written it. This is the clearest evidence available for why the structural lever had to be load-bearing and a prompt clause could not be: measured on the very reproduction it was written for, the clause did not change the behaviour it describes.

### D4 — The reproduction the demo app cannot currently produce

**Decision.** Add a mutation to `examples/demo-app` that reads a POSTed body, holds server-side state, and redirects **back to its own page** with the form reset.

**Why a new page.** The support flow added for `trustworthy-verdicts` is `POST → delay → 302` but redirects to `support-sent.html` — a *different* page, so its evidence survives and it cannot produce this defect. The distinguishing property here is same-page redirect plus reset form, and no existing page has it.

**Why server-held state.** The duplicate must be *observable* — a list that grows to two entries — or the reproduction proves nothing. A client-side stub would show the retry without showing the second write.

## Risks / Trade-offs

- **Residual risk: a duplicate write through non-identical actions.** Recovery that reaches the same commit by a genuinely different route — a different button with the same effect, a keyboard submit after a click — is not caught. This change narrows the defect, it does not close it. The documentation must keep saying that runs belong against disposable data, and the claim made in release notes must be "recovery no longer repeats a commit it already performed", never "no duplicate writes".
- **A legitimate repeat is refused.** A step that genuinely needs the same commit twice loses the second one, and a genuine retry of a commit that had no effect is refused as well. The model is told why and can proceed differently; the cost is one attempt of budget. Accepted for the asymmetry given in D1, and because our own documented format is one action per step.
- **Prompt growth.** The history adds lines to every recovery turn. Bounded by the per-step action ceiling (15) and only rendered for actions that succeeded, so it is small next to a 200-line snapshot.
- **D2 could regress auth**, as the analogous change once did. Verified against a real model: the dogfood suite's login journey passed, and the model cited the record explicitly — *"as confirmed by both the action record and the current snapshot"* — so the history is being read as history rather than as instructions.

## Migration Plan

None. No configuration, no test-file format change, no CLI surface change. Existing suites run unchanged; the only observable difference is inside a step that was already failing.

## Open Questions

None blocking. One deliberately deferred: whether the refusal should also cover `select`, which can trigger an `onchange` that submits. Left out because it would block the common legitimate case (re-selecting after a form reset) to cover an uncommon one, and because no reproduction has shown it.
