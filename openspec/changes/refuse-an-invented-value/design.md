# Design: refuse-an-invented-value

## Context

The value rule has been in `prompts.ts` since 0.7.0 and has never been enforced. `AGENTS.md` names this exact shape as the repository's recurring defect — a guarantee implemented as guidance — and it has already produced a secret leak, a budget that missed `plan`, and a timeout that missed `auth`. This is the same defect in the value rule.

The enforcement pattern exists and is one file away. `StepRecovery` (`runner/recovery.ts`) owns the repeated-commit refusal for #28: one object per step, holding what the step has done, answering *may this action be performed*. It is called from exactly one place, `executor.ts:372`, before `performAction`. A second refusal belongs there and nowhere else.

**Empirical starting point.** Every `fill` in this repository's own suite names its value in the step — `fill the note field with Check the invoice`, `fill the subject field with Order never arrived`, `fill the email field with {{env.TEST_EMAIL}}` in the login template. That is not luck: the README's central authoring rule *is* this rule (*"A step that enters a value writes the value"*). So enforcement is not a new constraint on users; it is the documented contract, finally checked. The false-positive rate against the suite we ship is zero.

## Goals / Non-Goals

**Goals:**
- A typed value is traceable to something the test or the application supplied
- Refusal explains what the model may draw from, so it can correct itself within the step
- The guarantee holds over the whole step, not at the instant of one snapshot

**Non-Goals:** semantic matching, a model call to adjudicate, a flag, changing `press`/`navigate`, replacing the static authoring warning.

## Decisions

### D1: One refusal object per step, not a check where the value is used

The check joins `StepRecovery` rather than sitting in `performAction` or in `actions.ts`. Two reasons, and the second is the one that matters.

The value rule is scoped to the step — "from the page" means the page as this step has seen it — so the decision needs the step's accumulated state, which is precisely what `StepRecovery` is. And a check written at the point an action is performed is the call-site shape this codebase keeps being bitten by. `recovery.ts` already carries that argument in its own docblock; this change should not reintroduce what that file exists to avoid.

### D2: "From the page" means any snapshot shown during this step, not the current one

The naive reading — compare against the snapshot in hand — has a real false positive. The model reads order `#BP-1001` on `/orders`, navigates to `/search`, and types it into the box. At that moment the current snapshot does not contain the value, and a check against it alone would refuse a completely legitimate action.

So `StepRecovery` accumulates every snapshot it has been shown in this step. Bounded by construction: `max_snapshot_lines` caps each one and `maxIterationsPerStep` caps how many there are, and the instance dies with the step.

This is the same shape as the repeated-commit guarantee sitting beside it — a property of the step as a whole, held by an object that cannot outlive it.

### D3: The permitted sources, in full

A value passes if it is any of:

1. **An `{{env.*}}` placeholder.** Substitution happens inside `performAction` via `resolveValue`, *after* the refusal point, so `action.value` still holds the literal placeholder here. The check never sees a secret, and must not: a masked value can match neither the step nor the page, so treating placeholders as unsourced would refuse every authenticated test.
2. **The step text.** Human-authored, short, stable — the source the README teaches.
3. **Any snapshot shown this step** (D2).
4. **The step's own action history.** A value the model already typed successfully passed this check when it did, so allowing it again is a transitive closure, not a hole. It covers the redirect case `contained-recovery` was built for: a submit answered by a reset form, where the page has lost the value the model legitimately used a moment ago.

### D4: Compare against the *masked* snapshot — what the model was shown

`executor.ts` passes `mask(snap)` to the model, never the raw tree. The check must use the same text.

Checking the raw snapshot would mean the executor and the model disagree about what the page said: a secret rendered on the page is `***` to the model, so it cannot have copied it, and accepting it as a source would credit the model with access it never had. The mask is the boundary for everything crossing into a prompt, and it is the boundary here too.

### D5: Normalise case and whitespace, and nothing else

Comparison is case-insensitive with runs of whitespace collapsed. That covers the differences that are genuinely about presentation.

Every step past that — stripping punctuation, reformatting numbers, matching token subsets — starts guessing at intent, and each loosening silently weakens the guarantee while looking like a kindness. `1234` in the step and `1,234.00` in the field is a real case this refuses, and it is named in Risks rather than half-solved.

### D6: `fill` and `select` only

`fill` is where fabrication happens. `select`'s value is an option label, which is in the snapshot by definition, so it costs nothing and closes the obvious way around a `fill` refusal.

`press` is excluded: its value is a key name (`Enter`, `Tab`), which is neither in the step nor on the page, and refusing it would break every test. `navigate` is excluded: its value is a URL, already bounded by `allowed_origins` — a stricter and better-targeted rule than this one.

### D7: A refusal costs one failed attempt

Identical to the repeated-commit refusal, and for the same reason: a model that insists terminates on the retry budget rather than grinding to the per-step iteration ceiling. Consistency here is not merely tidiness — two refusals at the same call site behaving differently toward the same counter is how DEF-001 happened.

### D8: Always on, no flag

The repeated-commit refusal has no flag. A correctness guarantee that must be switched on is guidance with extra steps, which is the defect this change exists to close.

### D9: This check is language-independent, and that closes a gap the static one leaves

`detectMissingValues` is explicitly English-only — its verb list, connectors and phrasal-verb exception are English grammar, and its docblock warns that an empty result means "nothing found in English", never "this suite is clean". A Portuguese or Japanese suite gets no static warning at all.

This check compares strings. It does not parse the step, so it holds for every language equally. The two are complements, not duplicates: the static one predicts before a key is needed, the runtime one guarantees regardless of language.

## Rejected alternatives

- **A1 Make the model declare the source in the action schema** (`source: step | page | env`, then verify the claim). Attractive: refusals could quote the claim back, and stating a source makes fabrication deliberate rather than default. Rejected for now — the verification underneath is the same substring test, so it buys message quality at the price of changing every structured-output call and every prompt. Worth revisiting if D5's plain comparison proves too blunt in practice.
- **A2 Warn instead of refusing.** That is 0.12.0, and 0.12.1 had to correct its wording to admit the step is carried out anyway. Escalating this warning to a guarantee *is* the issue.
- **A3 Refuse only on steps the static check flags.** Couples a runtime guarantee to an English-only heuristic, so a non-English suite would get no enforcement at all (D9). It also inverts the dependency: the guarantee would rest on the weaker check.
- **A4 Ask a model whether the value is derivable.** A call per fill, on the hot path, asking the model to police itself. The thing being enforced is that the model's judgment is not the guarantee.
- **A5 Record provenance in the report without blocking.** Makes fabrication visible, which is better than today, but still ships a green test over an invented value. The verdict is the artifact people gate merges on.
- **A6 Check inside `performAction`.** The call-site shape (D1); `actions.ts` has no notion of a step, so it could not implement D2 at all.

## Risks / Trade-offs

- **A legitimate value reformatted between the step and the field is refused** — `1234` typed as `1,234.00`. Real, unmeasured, and zero occurrences in the suite we ship. The refusal names the permitted sources, so the model's obvious next move is to type the literal, which works. Accepted with the limit stated in the docs rather than papered over.
- **A short value matches by accident.** `3` will appear somewhere in almost any snapshot, so a fabricated `3` passes. This is a floor, not a ceiling: it closes the case that was measured — a whole invented sentence — and does not claim to close every one.
- **A suite that passed by fabricating now fails.** That is the defect. It is a behaviour change, released as a minor, and named in the changelog.
- **Snapshot accumulation costs memory per step.** Bounded by `max_snapshot_lines` × `maxIterationsPerStep`, discarded with the step. Stored normalised, so it is compared, not re-processed, on each check.

## Migration Plan

No migration for a suite whose steps name their values — the shape the README teaches and every shipped test follows. A suite relying on fabrication starts failing, which the static authoring warning has been predicting since 0.12.0 and `--fail-on-authoring` already gates.

## Open Questions

(none)
