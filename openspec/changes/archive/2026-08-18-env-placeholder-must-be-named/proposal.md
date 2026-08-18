# Proposal: env-placeholder-must-be-named

## Why

0.14.0 refuses a `fill`/`select` value the model cannot trace to the step, the pages it was shown, or a value it already typed. One thing is exempt unconditionally — an `{{env.*}}` placeholder (`src/runner/recovery.ts:215`).

The exemption is necessary: substitution happens after the check, so a placeholder is all there is to see, and the masked page shows `***` where the secret is. Treating it as ordinary text would refuse every authenticated test.

But it asks the wrong question. It asks *is this a placeholder?* when what makes one legitimate is *did the test point this secret here?* Nothing checks the second, so the model can name a variable no step mentioned and the runner substitutes it. An adversarial pass against Actual Budget with `blastproof@0.14.0` did exactly that: given `fill the Password field` with no value, the model supplied `{{env.ACTUAL_PASSWORD}}` itself, and the real password was typed.

Worse than it looks. The secrets mask is built from the variables **referenced** in the config and the parsed tests (`src/commands/run.ts:156-164`) — and only those. A variable set in the environment but named by no step is never registered, so nothing redacts it. Verified end to end: the value is typed into the page and comes back in the next snapshot handed to the model, unredacted. The placeholder exemption can defeat the secrets mask, which is the guarantee `run-wide-secret-mask` exists to provide. Issue #66.

## What Changes

A value may reference an `{{env.*}}` variable only when the step being executed references that same variable. A value naming any variable the step does not is refused at the same choke point, with the same retry cost.

The check reuses `referencedEnvVars` from `runner/env.ts` — the function that already decides what a placeholder is for substitution and for masking — replacing the second, subtly different regex in `recovery.ts`.

## Capabilities

### Modified Capabilities

- `agentic-execution`: an `{{env.*}}` placeholder is admissible only when the step names that variable, so a substituted value is always one the test asked for and the mask knows

## Impact

- New dependencies: **none**
- Affects: `src/runner/recovery.ts`, `tests/`, README, `docs/auth.md`
- **Not additive**: a suite whose steps do not name the variables their values reference now fails. No such suite can have worked as intended — an unnamed variable is one the author never pointed at that field — but it is a behaviour change, so a minor bump

## Non-goals

- No change to how substitution or masking work; this narrows what reaches them
- No registration of a model-supplied variable into the mask on the fly — that hides the leak while still typing a secret the author never pointed there
- No widening to "any step in the test" or "any step in the suite". Run-wide scope is exactly what disguised this defect in the run that found it
- No change to `auth.headers`/`auth.cookies`, which never pass through the executor's value path
