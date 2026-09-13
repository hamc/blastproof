# Design: skip-a-login-nothing-selected-needs

## Context

The session has one producer and many consumers, and only the consumers ask whether it is wanted.

```ts
// src/commands/run.ts:749 — the producer
if (config.auth) {

// src/commands/run.ts:311 — a consumer
const context = await browser.newContext(test.auth ? contextOptions(session) : {});
```

`config.auth` answers *"is a session configured for this project"*. `test.auth` answers *"does this test want one"*. The first is a property of the repository and the second of the run, and the producer is asking the wrong one.

Four things were read rather than assumed, and each one makes the fix smaller or safer:

**`selected` already exists at the call site.** It is printed one line above the login, in `blastproof run: N test(s), provider=…`. The predicate needs no new plumbing and no reordering — it needs the variable already in scope.

**`test.auth` is always a boolean.** `src/runner/testfile.ts:18` declares `auth: z.boolean().default(true)`, so there is no `undefined` case to get wrong and no distinction between "declared true" and "did not say".

**A setup step cannot need the session in a test that opted out.** The context is created per test at `run.ts:311`, and `executeTest` runs that test's setup steps inside it. So `auth: false` already means "no session for anything in this test, setup included". The combination this design was worried about does not exist, and no exception is needed for it.

**The ceiling charges for the login separately.** `printDryRun` appends `config.auth.steps` to the estimated set as a synthetic test. That was deliberate — DEF-001's rule that a ceiling must not be exceedable by anything it claims to bound — so it has to move with the run or it becomes wrong in the other direction.

## Goals / Non-Goals

**Goals:**
- A run does not perform work no selected test can consume
- The three consequences close together: the cost, the budget-exhaustion verdict, and the exit 2 over an unread `storage_state`
- The predicate is structural — no new state, no flag, no second source of truth

**Non-Goals:** `plan`, the login journey, `auth.cache`, the strategies, `auth: false` semantics, and the exit-2 rule for a login that was genuinely needed.

## Decisions

### D1: The predicate is "some selected test wants the session"
```ts
if (config.auth && selected.some((test) => test.auth)) {
```

`selected` is the post-filter set, which matters: computing it from `parsed` would reintroduce the same disagreement one level up, asking about tests the run will never execute.

`some`, not `every`: one authenticated test in the selection is enough to need the login, and there is no partial login to perform.

### D2: Skip for every strategy, not only `steps`
The cost argument only applies to `auth.steps`, which spends model calls; `storage_state`, `headers` and `cookies` are free to establish. Skipping them anyway is not tidiness — it is the strongest of the three defects:

`resolveSession` reads `auth.storage_state` from disk and throws `AuthError` when it cannot, which `run` turns into exit 2 before any test executes. So a selection of `auth: false` tests fails, deterministically, over a file none of them would have opened. A rule that skipped only `steps` would leave that in place while claiming to have fixed the issue.

### D3: The ceiling moves in the same change, under the same predicate
`printDryRun` gets the same condition, from the same `selected`. Two call sites reading one predicate, and the tasks pin them together: a test that asserts the ceiling drops for an `auth: false`-only selection is what stops the two drifting.

The direction of the failure matters here. A ceiling that keeps charging for a login the run no longer performs is *conservative* — it overestimates, and nothing exceeds it. That is why this is a correctness-of-reporting fix rather than a safety one, and why it must not be deferred to "later": an overestimate that persists teaches people to discount the number, which is how a ceiling stops being read at all.

### D4: `plan` keeps authenticating unconditionally
`plan` snapshots pages for routes it is drafting, and it has no selected tests to consult — the whole point is that it is generating the tests. Any route may sit behind a session, and a planner that snapshotted the login wall would produce drafts describing the login wall. The predicate has no meaning there, and inventing one would be worse than the waste it saved.

### D5: Nothing is printed when the login is skipped
`Authenticating...` simply does not appear. The alternative — a line saying the login was skipped — was rejected: it reports the absence of work nobody asked for, on every run of an unauthenticated selection, and this project already has three warnings competing for a reader's attention (#103).

## Rejected alternatives

- **A flag (`--no-auth`).** The information is already in the selection. Asking the user to pass it is asking them to compute what we can read, and they would pass it wrong.
- **Lazy authentication — establish the session on first use.** It fixes the cost and breaks the guarantee: authentication currently happens *before the first test*, so a login failure is a configuration error with exit 2 rather than N mysteriously failing tests. Deferring it moves that failure into the middle of a run.
- **Skip only when `auth.steps` is configured.** Cheapest, and it leaves the exit-2 path untouched. See D2.
- **Make it a `--dry-run`-only fix to the ceiling.** Fixes the number and none of the three defects.

## Risks / Trade-offs

- **A test that omits `auth:` defaults to `true`**, so a suite that never mentions the field behaves exactly as it does today. This is the common case and it is untouched — which also means most users will never see this change, and its value is concentrated in the `--impacted` runs where the selection is small.
- **`auth.verify` no longer runs when nothing needs the session.** That is correct — it verifies a login that did not happen — but it does mean a broken `auth:` configuration goes unnoticed for longer, surfacing on the first run that selects an authenticated test. Accepted: the alternative is failing runs over a facility they do not use.
- **Two call sites read the predicate** (the run and the ceiling). Same shape as the warning in `name-what-the-diff-did-not-see`, and the same mitigation: a test on each, and one of them asserts they agree.

## Migration Plan

None. No config, no flag, no format, no exit code for any run that needed its login.

## Open Questions

- **Should `plan --dry-run` authenticate?** It is out of scope here, but `plan` establishes a session before deciding there is nothing to draft. Worth its own reproduction rather than a guess.
