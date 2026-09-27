# Design: label-a-redaction-with-its-variable

## Context

Four things read rather than assumed:

**The judge sees the step through the mask.** `executor.ts` calls `brain.judge(mask(step), mask(expectation), maskedSnap, …)`. A step naming a registered value literally reaches the judge as `***`, exactly like the page. So "verify the page shows X" is a comparison of `***` with `***` whatever X was. #87 assumed it could never pass; measured, it passes whether true or false (proposal, table).

**The mask already knows every name.** Since #109, `SecretsMask` keeps `value -> name` for every value `registerFrom` registers, to name a near-miss. Nothing in `src/` registers a value without a name. The label costs no new bookkeeping.

**The source check reads masked text, by design.** `recovery.ts` builds the haystack a typed value must come from out of the step and every **masked** snapshot (`observe(maskedSnapshot)`), so the model is never credited with a value it could not see. The consequence: anything the mask writes into the page is, to that check, a value on the page. With `***` that was already true. A label makes it likelier the model copies it, because it looks like content.

**`plan` shares the mask.** `commands/plan.ts` builds its own `SecretsMask` from the auth recipe, so drafting models see labels too, and could write one into a step.

## Goals / Non-Goals

**Goals:**
- Masking preserves whether two values are the same, and nothing else about them
- The false PASS in the proposal becomes a FAIL, and the true one stays a PASS
- A label can never be typed into a page

**Non-Goals:** unmasking, a `secrets:`/`data:` split, hiding variable names.

## Decisions

### D1: `[redacted NAME]`
The label is `[redacted ` + the variable name + `]`. Chosen for three properties:

- **It reads as withheld content**, in a report and to a model, without explanation. `***NAME***` reads as markdown emphasis to a model and as noise to a person.
- **It cannot be mistaken for a placeholder.** `{{env.NAME}}` would have been more familiar, but a placeholder is something the executor *substitutes*: a model copying it from the page into a step that names that variable would get the real value typed, correctly, and one copying it into a step that does not would be refused by #66. That is coherent for the executor and misleading for a person reading a report, who would conclude the application rendered a template tag.
- **It names nothing derived from the value.** No length, no prefix, no hash: each of those narrows the value, and a hash of a short password is a lookup.

A value with no name becomes `[redacted]`. It cannot occur from `src/` today, and it keeps the property that nothing is invented.

### D2: The label comes from the registered value, whichever form matched
The replacement callback already has the registered value in hand (it is what the pattern was built from). The label is that value's name. So a near-miss (`HUNTER2` on the page, `hunter2` registered) and the percent-encoded form both produce `[redacted PROBE_SECRET]`: the label identifies the secret, not the spelling that was found.

Two variables holding the same value keep #109's rule, first name wins. They are one secret, so one label is correct.

### D3: A label in a typed value is refused
`fill` and `select` values containing `[redacted` are refused in `recovery.ts`, next to the source check, with a result the model can act on: a label stands for a withheld value; a value from `{{env.*}}` is entered by the placeholder the step names.

It is a prefix match on `[redacted`, not the full label. A model that copies part of one, or rebuilds one around a different name, is equally wrong.

This also covers `plan`: a draft whose step says "fill the email with [redacted TEST_EMAIL]" fails at run time on this refusal, with an explanation, instead of typing the label.

Alternative: **translate a copied label back into its placeholder.** It would make the action succeed, and it is the exemption #66 closed. The model would be supplying a secret the step never pointed at.

### D4: The prompts describe labels, not `***`
The executor prompt (`prompts.ts:24`) and the judge prompt (`prompts.ts:118`) are rewritten around the label: what it stands for, same label means same value, different labels mean different values, never type one. The judge's existing clause, "a step you genuinely cannot check against what you were shown still fails", stays: it is what turns `[redacted OTHER_SECRET]` against `[redacted PROBE_SECRET]` into a FAIL rather than a shrug.

### D5: Output changes, and says so
Logs, JUnit and the HTML report show the label where they showed `***`. It is marked **BREAKING (output)** in the proposal and belongs in the changelog. A consumer grepping reports for `***` stops matching; nothing grepping for secrets starts matching, since the value never appears.

## Risks / Trade-offs

- **A variable name can itself be telling** (`STRIPE_LIVE_KEY`). → It is already in the test file, the config and every "not set" error. Nothing new is disclosed, and the reports are the files people share; the name is what lets them read a failure.
- **The prompt change could shift verdicts beyond the two measured cases.** → Verified live on both, plus the existing dogfood suite. A model that had learned `***` means "fine, move on" now reads a name, which is more information, not less.
- **Tests that pin `***`** across `env`, `executor`, `containment`, `planner` and the near-miss tests. → They are updated to the label, and each update is a place the behaviour is now asserted rather than assumed.

## Migration Plan

None for configuration. Anyone parsing reports for `***` needs to match `[redacted ` instead; the changelog says so.

## Open Questions

None that change the specs.
