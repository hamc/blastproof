# Proposal: auth-recipes

## Why

blastproof can only test pages that are reachable logged out. In most products the value lives behind a login, so today the tool proves itself on a marketing page and stops at the door. Three concrete consequences: `plan` cannot generate tests for authenticated routes because it snapshots the login wall; every test that needs a session repeats the login steps, costing ~30s each even in a trivial app; and `AGENTS.md` already documents an optional `auth` recipe that does not exist in the config schema, so the docs promise something the code lacks.

## What Changes

- Add an optional `auth:` section to `.blastproof/config.yaml` with three interchangeable strategies, chosen by which field is present:
  - `steps:` — a plain-English login journey, executed once by the existing agentic executor (covers form login and any UI-driven flow)
  - `storage_state:` — a path to a previously captured Playwright storage state (covers SSO, MFA and magic links, where a human completes the flow once)
  - `headers:` / `cookies:` — static values, typically `{{env.*}}` placeholders (covers token- and cookie-based auth, no browser needed)
- Authenticate **once per run**, then reuse the resulting storage state for every test context and for the planner
- Optional `auth.verify:` — a plain-English check that authentication actually worked, so a broken login fails once with a clear message instead of as N mysterious test failures
- Tests may opt out with `auth: false`, which a login test itself requires — it must start logged out
- Captured storage state is treated as a credential: written under `.blastproof/`, git-ignored by `init`, and never logged

## Capabilities

### New Capabilities

- `authentication`: the strategies, when authentication runs, how the session is reused, verification, failure behaviour, and the handling of the captured state as a secret

### Modified Capabilities

- `yaml-test-format`: new optional `auth` field (default `true`) letting a test run unauthenticated

## Impact

- New dependencies: **none**. Playwright already provides `storageState`, and the login journey reuses the existing executor, env placeholder substitution and secret masking
- Affects: `src/config.ts` (schema), new `src/auth.ts`, `src/commands/run.ts` and `src/commands/plan.ts` (context creation), `src/runner/testfile.ts`, `src/commands/init.ts` (scaffold comments and gitignore), `tests/`, README, `AGENTS.md`
- Additive: a project without an `auth:` section behaves exactly as today

## Non-goals

- No credential storage of any kind: values come from the environment via `{{env.*}}`, as steps already do
- No automated handling of MFA codes or email magic links; those are what `storage_state` exists for
- No per-test distinct users or role matrices — one session per run in this slice
- No refresh of an expired session mid-run
