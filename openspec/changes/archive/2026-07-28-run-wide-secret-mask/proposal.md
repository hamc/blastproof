# Proposal: run-wide-secret-mask

## Why

"Secrets never reach the model" is asserted in the README, in `AGENTS.md`, and in the config `init` writes for every user. It is false in three ways, all reproducible. The mask is built per test from that test's own steps, so a credential used to authenticate is unknown to it — an authenticated page that echoes the token feeds it straight to the model. `plan` has no masking at all: it authenticates, navigates the session to real routes, and hands the snapshot to the model unredacted. And masking matches literal strings, while `navigate` reports a percent-encoded URL, so a secret containing a space or `#` no longer matches and passes through.

The previous fix put a choke point in the executor. It closed the channel it was told to guard and never asked which other callers talk to a model.

## What Changes

- Build one mask per run, seeded from the auth recipe and every test's placeholders, and share it with everything that reaches a model
- Apply it in the planner, which had none
- Mask percent-encoded forms of a secret as well as its literal text
- Route `--dry-run` through the unmapped gate, which it bypassed

## Capabilities

### Modified Capabilities

- `agent-containment`: the guarantee is stated over the whole run and every command that prompts a model, not over one test in one command

## Impact

- New dependencies: **none**
- Affects: `src/runner/env.ts`, `src/commands/run.ts`, `src/commands/plan.ts`, `src/planner.ts`, `src/auth.ts`, `tests/`
- No interface change: nothing a user writes or configures moves

## Non-goals

- No attempt to cover every transform a page could apply to a secret before rendering it; percent-encoding is covered because an ordinary action produces it, and the limit is documented rather than implied away
- No change to how reports mask, which was verified correct
