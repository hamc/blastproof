## Context

Two prompts describe what a good step looks like, and they disagree.

`agentSystemPrompt` (the executor's) has been tightened three times by real defects, and since 0.7.0 it forbids inventing a value:

> Never invent a value. A value you type must come from the step, from the page, or from an `{{env.*}}` placeholder.

`plannerSystemPrompt` still says:

> End with at least one step that verifies an observable outcome (visible text, a count, a state change).

"At least one, at the end" was reasonable when it was written. It is not the rule any more. The README now opens its writing guidance with the stronger one and shows the measurement: Score 64 to Score 100 on two rewritten steps, same application, same suite, same version.

Generated against this repository's demo app:

```yaml
steps:
  - Navigate to the Support page
  - Enter a subject in the Subject textbox
  - Enter a message in the Message textbox
```

Every one bare, and two naming no value. The executor is then required to refuse to invent those values, so `plan` drafts a test that `run` is designed not to complete.

## Goals / Non-Goals

**Goals:**
- Drafts demonstrate the rule the documentation teaches.
- A draft never depends on a value it does not supply.

**Non-Goals:**
- Machine-validating that a step "states an outcome".
- Changing anything about how drafts are written or run.

## Decisions

### D1 — Teach the planner the rule the README teaches, in the same words

**Decision.** Replace "end with at least one step that verifies an observable outcome" with the rule as the README states it: each step names what should be true once it has been carried out, and an action worth taking is worth saying the result of. Add that a step supplying a value must write the value.

**Why the same words.** Two documents describing the same rule differently is how they drifted in the first place. The README's phrasing is the one that has been measured and the one a user reads before writing their own tests, so a draft that mirrors it is also a worked example of it.

**Why the value clause belongs here.** The executor already refuses to invent values (0.7.0, `contained-recovery` D3), which means a draft that says "Enter a subject" is not merely fragile — it is unrunnable by design. The generator is where that can be prevented, and prevention is cheaper than a refusal at run time that the person then has to interpret.

### D1b — "One action or check per step" had to change with it

**Decision.** The planner's first rule becomes "one move per step — a single action together with what it should produce, or a single check. Never two unrelated actions in one step."

**Why.** As written, "one action **or** check per step" contradicts the rule being added: the README's own worked example — *"submit the add-task form and verify the task appears in the list"* — is one action **and** one check. Adding the new rule beside the old one would have shipped two instructions that cannot both be followed, which is a worse failure than the one being fixed.

**What this must not break.** `contained-recovery` D1 cited that phrase as evidence that a step needing two identical commits contradicts the documented format, and that argument holds under the new wording: one *move* still means one commit, and "never two unrelated actions in one step" says so more directly than the phrase it replaces.

### D1c — The planner did not know where a run starts, and this change exposed it

**Decision.** The planner is told that a run begins at the application's base URL rather than at the route being generated for, and that the draft must open with a step navigating there and stating what should be visible.

**Why it surfaced now.** The old drafts opened with a bare `Navigate to the Support page`. Pushing the model toward outcome-carrying steps made it **drop the navigation entirely** — the first generated draft under the new prompt began with `Fill the Subject textbox with …`, and running it failed on the home page: *"there is no Subject textbox visible on this page"*.

That was a regression this change introduced, caught by running a generated draft rather than by reading it. The underlying gap is older: the planner has never been told where execution starts, and it happened to emit a navigation only because it was listing actions naively. Removing the naive listing removed the accident that was covering the gap.

**Consequence for the verification.** Reading drafts is not enough to judge a change to the generator. A draft has to be run.

### D2 — Put the rule in the spec, not only in the prompt

**Decision.** `test-generation` gains a requirement that a generated step states its own outcome and carries any value it needs.

**Why.** Today the rule lives in one string in one file. That is exactly the shape that drifted from the README without anyone noticing for a release. A requirement with scenarios is what makes the next change to that prompt have something to be checked against.

### D3 — No machine validation of drafts

**Decision.** Nothing rejects a draft for failing the rule.

**Why.** Whether a plain-English sentence "states an outcome" is not decidable by a parser. A heuristic — look for a verb like *verify*, require two clauses — would reject good drafts and pass bad ones, and would do it silently at generation time when there is nothing to fall back on. `plan` already prints drafts and requires `--write` to persist them, and the README already says drafts need review before they join a suite. That review is the check, and pretending to automate it would weaken it by implying it had been done.

**What this means honestly.** This change improves the odds; it does not guarantee the output. The verification below is therefore a sample of real generations, not a proof.

## Risks / Trade-offs

- **The model may still emit a bare step.** Prompt guidance is the weakest lever available, and DEF-005 records this project reaching for it too readily. It is the right lever *here* only because the alternative — validating prose — is worse, and because a bad draft costs a review comment rather than a wrong verdict.
- **Longer steps.** A step carrying its outcome and its value is a longer sentence, and the drafts will read less like a checklist. That is the shape that works.
- **Verification is a sample.** Two routes generated before and after is evidence, not proof. Stated as such in the tasks rather than dressed up.

## Migration Plan

None. Drafts already written are untouched; only newly generated ones change shape.

## Open Questions

None blocking. Noted: `plan`'s provenance header could name the rule, so someone reviewing a draft is reminded what to check it against. Left out as a separate, smaller question about the header's content.
