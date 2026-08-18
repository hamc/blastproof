# Design: env-placeholder-must-be-named

## Context

`refuse-an-invented-value` closed the case where a model types a value from nowhere. It left one door open by design, and the design reasoned about the wrong half of it.

D3 of that change argued — correctly — that a placeholder cannot survive a text comparison: substitution runs after the check, and the masked page shows `***`, so comparing would refuse every authenticated test. It then drew the wrong conclusion, that a placeholder needs no check at all. "Is this well-formed?" became a proxy for "did the test ask for this?", and those are different questions.

The consequence is not merely that the sourcing rule is bypassable. Because the mask registers only the variables the config and the tests reference, a variable that is set but unnamed is substituted **and** unmasked — so a live credential reaches the model's prompt and the run's artifacts. That is a hole in `run-wide-secret-mask`, reached through `refuse-an-invented-value`.

## Goals / Non-Goals

**Goals:**
- A substituted value is always one a step asked for, and therefore always one the mask knows
- One definition of "a placeholder" in the codebase, not two
- The refusal explains without inviting another guess

**Non-Goals:** changing substitution or masking, registering model-supplied variables, widening the scope beyond the current step.

## Decisions

### D1: Every variable a value references must be referenced by the step

Not "the value is a placeholder" but "the value references only variables this step names". Per-variable, so a value composing two placeholders is admitted only if the step names both.

The model cannot know the name of a variable nobody showed it. If it produces one, it guessed — and refusing a guess is the entire point of the surrounding change.

### D2: Reuse `referencedEnvVars`, delete the second regex

`recovery.ts` carries `ENV_PLACEHOLDER`, and `runner/env.ts` carries a different one used by both `substituteEnv` and `SecretsMask.registerFrom`. They disagree, and it is measurable:

| value | `env.ts` (substitutes and masks) | `recovery.ts` (exempts) |
|---|---|---|
| `{{env.TOKEN}}` | yes | yes |
| `{{ env.TOKEN }}` | yes | **no** |
| `Bearer {{env.TOKEN}}` | yes | **no** |

Two rules about the same concept, maintained by hand, already drifted — the shape `AGENTS.md` names as this repository's recurring defect, and the shape #45 exists about. The fix is not to align them but to have one: `referencedEnvVars` already answers "which variables does this text reference", which is exactly the question both callers need.

This also fixes the disagreement's practical effect. Today `Bearer {{env.TOKEN}}` skips the exemption and falls to the string comparison, passing only because the step happens to contain that text. After this change it is judged by the same rule as every other value.

### D3: Compare against the raw step text, not the normalised haystack

`StepRecovery.readable` holds the step lowercased, because case is presentation for a typed value. Environment variable names are **not** presentation: `TOKEN` and `token` are different variables, and matching case-insensitively would admit `{{env.token}}` on a step naming `TOKEN` — a different secret, or none.

So the instance keeps the step verbatim alongside the normalised copy. Two fields holding the same string in two forms is a small cost for not having a case-folding bug in the one place that decides which secret gets typed.

### D4: The current step, not the test, not the suite

The strictest reading available, and the one the defect argues for.

The adversarial run saw the mild version of this bug — the secret was masked — precisely because sibling tests in the same batch referenced `ACTUAL_PASSWORD` and the mask is run-wide. Widening this check to the same scope would reproduce that accident: the check would pass because of a neighbouring test, and the reader would have no way to tell an intended secret from a guessed one.

Setup steps carry their own text and are checked identically. An `auth.steps` journey runs through the same executor with the recipe's step as the step text, so a recipe naming its own placeholder is unaffected.

### D5: Same choke point, same cost

The check joins `unsourcedValueRefusal`, ahead of the exemption it qualifies. One decision site, one retry accounting, no new counter — the reasoning in `refuse-an-invented-value` D1 and D7 applies unchanged.

### D6: The message must not teach the attack

The existing refusal quotes the offending value, which is safe here — the placeholder is not the secret. But it must not read as *try a different variable*. It names what the step references, and offers the two legitimate exits: use a value the step supplies, or fail the step because it supplies none.

### D7: The invariant this restores

**A substituted value is always a masked value.** It holds today only by coincidence of scope; after this change it holds by construction, because a step that names a variable is a step `buildRunMask` registered from.

Worth stating in the spec rather than leaving as an emergent property, since the two mechanisms sit in different files and neither currently says it depends on the other.

## Rejected alternatives

- **A1 Check the mask instead** — "refuse a value whose expansion the mask does not know". Equivalent in effect today and cheaper to state, but it couples the executor to the mask's contents and expresses the wrong intent: the question is whether the *test* asked for this secret, not whether some other test did.
- **A2 Widen to any step in the test or the suite** — recreates the run-wide accident that disguised the defect (D4).
- **A3 Drop the exemption entirely** — refuses every authenticated test; this is what `refuse-an-invented-value` D3 correctly rejected.
- **A4 Register the model's variable into the mask on the fly** — removes the leak and keeps the wrong behaviour: a secret still gets typed into a field the author never pointed at, now invisibly. Treats the symptom that makes it findable.
- **A5 Warn instead of refusing** — a warning next to a typed credential is a report of something that already happened.

## Risks / Trade-offs

- **A suite whose steps do not name their variables now fails.** No such suite can have worked as intended, since an unnamed variable is one nobody pointed at that field. Released as a minor.
- **Two copies of the step string per instance** (verbatim and normalised). Bounded by the step, discarded with it (D3).
- **This does not stop a secret being typed into the wrong *field*.** A step naming `{{env.PASSWORD}}` consents to that secret in that step; which control receives it is the resolver's business, and #60's.
- **`auth.headers` and `auth.cookies` are untouched**, since neither passes through the executor's value path. Their placeholders are resolved and masked at the auth boundary.

## Migration Plan

No migration for a suite that names the variables it uses — the shape every documented example and every shipped test already follows. A suite relying on the model to supply a variable name starts failing, which is the defect.

## Open Questions

(none)
