# Proposal: skip-a-login-nothing-selected-needs

## Why

Two decisions about the same session disagree. The run establishes it (`src/commands/run.ts:749`):

```ts
if (config.auth) {
```

Each test consumes it, thirty lines earlier (`src/commands/run.ts:311`):

```ts
const context = await browser.newContext(test.auth ? contextOptions(session) : {});
```

So a run whose every selected test declares `auth: false` still performs the whole login (#102). Measured on this repository's own suite, with no key and no browser — selecting only the one test that opted out:

```
$ blastproof run --tag consent --dry-run
Dry run: 1 test(s) selected
Worst case: up to 126 model call(s) for this selection, including the login journey
```

With nothing selected at all the ceiling is 84, all of it login. **Two thirds of that ceiling belongs to a journey the selected test refused.**

It is not only cost, and this is the part that makes it a defect rather than waste:

- **A tight budget turns it into a verdict.** Exhaustion during the login sets `incomplete`, and an incomplete run exits 1 regardless of `--min-score`
- **A missing `storage_state` turns it into an exit 2**, deterministically. `AuthError` aborts the run over a session file nothing selected would have read

`--impacted` makes it the common case rather than the edge one: the tighter the diff, the larger the share of a run spent on a session nobody asked for.

## What Changes

- Authentication SHALL be performed only when **some selected test** will use the session. When every selected test declares `auth: false`, no login runs, no session is established, and no `storage_state` is read
- The dry-run ceiling SHALL stop charging for the login journey in exactly that case, in this same change — the ceiling must not become wrong in the other direction

## Capabilities

### Modified Capabilities

- `authentication`: the session is established for the tests that will use it, not for the configuration that declares it
- `run-budget`: the worst case counts the login only when the selection can incur it

## Impact

- New dependencies: **none**. `selected` already exists at the call site — it is printed one line above it
- Affects: one condition in `src/commands/run.ts`, the matching one in the dry-run ceiling, and their tests
- No config, no flag, no output format. A run with one authenticated test behaves exactly as it does today

## Non-goals

- **`plan` is untouched.** It authenticates for the pages it snapshots, and it has no selected tests to ask — any route it drafts for may sit behind a session. The same predicate does not exist there
- **The login journey itself is unchanged**, as are `auth.cache`, the strategies, and the exit-2-on-failure rule for a login that was actually needed
- **No new flag.** The information needed is already in the selection; asking the user for it would be asking them to compute what we can read
- **Not the `auth: false` semantics.** A test that opts out gets an empty context, exactly as now
