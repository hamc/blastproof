# Tasks: auth-recipes

## 1. Config schema

- [x] 1.1 `src/config.ts` — optional `auth` section: `steps` (list of strings), `storage_state` (path), `headers` (record), `cookies` (list), `verify` (string), `cache` (boolean, default false)
- [x] 1.2 `src/config.ts` — reject more than one strategy with a `ConfigError` naming the conflicting fields (design D2)
- [x] 1.3 Unit tests: each strategy parses, defaults applied, conflicting strategies rejected with both names in the message, absent section leaves config as today

## 2. Authentication

- [x] 2.1 `src/auth.ts` — `AuthSession` as the single internal contract (design D1): a Playwright `storageState` plus optional `extraHTTPHeaders`, whatever produced it
- [x] 2.2 `src/auth.ts` — `steps` strategy: run the journey once through `executeTest` in an empty context, then capture `context.storageState()`; env placeholders substituted and masked as the runner already does
- [x] 2.3 `src/auth.ts` — `storage_state` strategy: read and validate the file, failing with an error naming the path when unreadable
- [x] 2.4 `src/auth.ts` — `headers`/`cookies` strategy: build the session from static values with `{{env.*}}` substitution, no browser involved
- [x] 2.5 `src/auth.ts` — `verify`: judge the expectation against the post-login snapshot via `brain.judge`, failing authentication when it does not hold (design D5)
- [x] 2.6 `src/auth.ts` — `cache`: reuse a stored state only when `auth.cache` is enabled, otherwise re-authenticate and replace it (design D9)
- [x] 2.7 `src/auth.ts` — `AuthError` carrying an actionable message; the captured state is never logged or embedded anywhere (design D7)
- [x] 2.8 Unit tests with a fake page and stubbed brain: each strategy produces a session, verify failure raises `AuthError`, cache off re-authenticates, cache on reuses, no secret reaches the output on a mid-journey failure

## 3. Per-test opt-out

- [x] 3.1 `src/runner/testfile.ts` — optional `auth` field, default `true`
- [x] 3.2 Unit tests: default true, `auth: false` parses, non-boolean rejected

## 4. Wiring

- [x] 4.1 `src/commands/run.ts` — authenticate once before the first test; seed each context with the session unless the test declares `auth: false`; abort with exit 2 on `AuthError` before any test executes (design D3/D4/D6)
- [x] 4.2 `src/commands/plan.ts` — seed planner contexts with the same session, so drafts describe the real page rather than the login wall (design D8)
- [x] 4.3 Unit tests: one login for many tests, `auth: false` gets an empty context, auth failure exits 2 with no test executed and no score reported, planner receives the session

## 5. Scaffold, docs and safety

- [x] 5.1 `src/commands/init.ts` — commented `auth:` examples for all three strategies in the generated config, and ensure the captured state path is git-ignored (design D7)
- [x] 5.2 README: the three strategies with a worked example each, which to pick for which flow (form, SSO/MFA, token), the `auth: false` opt-out, and an explicit warning never to commit a captured state
- [x] 5.3 `AGENTS.md`: describe the implemented `auth` recipe, replacing the current mention of a recipe that does not exist

## 6. Verification

- [x] 6.1 Demo app: add an authenticated page so the recipe can be exercised end to end; the existing login test declares `auth: false`
- [x] 6.2 Against the demo app with a real provider: a `steps` recipe logs in once, an authenticated test passes without repeating the login, and `plan` drafts a test for an authenticated route describing the real page
- [x] 6.3 Wrong credentials abort with exit 2 before any test runs, and the password appears nowhere in the output
- [x] 6.4 `npm run build && npm run typecheck && npm test` all green
