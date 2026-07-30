## Why

A failing step can write to the application under test several times, and can write data nobody wrote a test for. Reproduced twice, on two applications, with two models (#28).

**Gitea.** Step: `click the button that creates the issue`. The click worked and the page navigated to the created issue. The expectation described the pre-click form, so it failed. Recovery navigated back to the form and submitted it again, twice. Three issues existed where the test intended one.

**TaskBoard**, against 0.6.0. Step: `submit the add-task form`. `POST` → 600ms → `302 /tasks` — back to **the same page**, form reset. The judge read an empty form and concluded nothing had happened. Recovery filled the subject field and submitted again. The next step read a total of 6 where it expected 5 and failed, correctly, on state the run itself had created. A second test did the same thing to a deliberately negative case: client-side validation blocked an empty submit, which was the intended outcome, and recovery filled the field and submitted for real.

In both TaskBoard cases the value typed was `New Task` — a string in no test file, no page, and no config. **It was invented.** Repeating a side effect writes the test's own data twice. Inventing a value writes data nobody wrote a test for.

### The shape

> **The action erases its own evidence.** `POST` → redirect → *the same page*, form reset. The state that proves the action succeeded is precisely the state the action destroys, so the post-action snapshot is indistinguishable from "nothing has happened yet".

This is not exotic. It is what every post/redirect/get framework produces. The agent is not being careless: it receives a snapshot and the last result, and is asked to recover from a state whose history it cannot see.

That is the root cause, and it is an information problem before it is a policy problem. **The executor knows what it has already performed in this step. The model does not.**

The mitigation we currently document — write the outcome into the step — is real and it works; both rewritten TaskBoard steps passed first time. But it is a workaround. A step as ordinary as `submit the add-task form` should cost a failed run, not an invented row in someone's database. And 0.6.0's stricter judge amplifies this: more assertions failing means more recovery, and recovery is what writes.

## What Changes

- **The model is shown what it has already done in this step** — the actions that succeeded, with their results — so a reset form no longer reads as an untouched one.
- **A commit action identical to one that already succeeded in the same step is refused rather than performed.** The refusal is returned to the model as the action's result, so it must choose differently. This is a guarantee held by the executor, not advice given to the model.
- The model is told not to invent a value for a field, the same way it is already told not to invent elements.
- The demo app grows the one shape it cannot currently produce: a mutation that redirects back to its own page with the form reset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agentic-execution`: a step cannot re-perform a commit it already performed, and the model chooses its next action with the step's own history in view rather than from the page alone.

## Non-goals

- **Not** classifying actions as mutating or observing. The accessibility tree cannot say whether a button writes to a database, and pretending otherwise would produce a guard that is wrong in both directions. What *is* decidable is whether an action is a repeat, and both reproductions mutate through a repeat.
- Not constraining anything across steps. The record is scoped to one step and reset at every boundary; a later step may repeat an earlier step's action freely. Within a step the guarantee is unconditional — scoping it to recovery after a failed judgment was tried and the reproduction disproved it (design D1).
- Not refusing repeated `navigate`, `fill`, `select` or `assert`. A navigation's effect is fully visible in the next snapshot and refusing it removes the model's only way to restore preconditions while protecting nothing; the same reasoning covers entering a value, which only becomes an effect when something commits it.
- Not undoing `trustworthy-verdicts`' re-observation or `judge-the-step`'s anchoring. Both stay exactly as they are.
- Not per-run usage reporting (#27) or the action vocabulary (#22).

## Impact

- `src/runner/executor.ts` — the per-step loop gains a record of what succeeded in this step, and a refusal path.
- `src/llm/prompts.ts` — `AgentIterationInput` and `agentUserPrompt` carry that record; `agentSystemPrompt` gains the no-invented-values rule.
- `src/llm/brain.ts` — passes the record through.
- `src/auth.ts` — the login journey runs through the same loop; verify explicitly that it is unaffected.
- `examples/demo-app/serve.mjs` and a new page — the reproduction.
- No new npm dependency.
