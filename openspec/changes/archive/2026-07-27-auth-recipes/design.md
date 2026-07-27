# Design: auth-recipes

## Context

Every test today runs in a fresh, empty browser context (m1 design D6: no cookie, storage or history leakage between tests). That isolation is right, and it is also why nothing can be tested behind a login. The planner inherits the same limitation: `generateForRoute` loads a route and snapshots it, so an authenticated route yields a snapshot of the login page and a draft that tests the login wall instead of the feature.

The pieces needed already exist. Playwright contexts accept a `storageState` (cookies plus origin local storage). The agentic executor already runs plain-English journeys. `runner/env.ts` already substitutes `{{env.VAR}}` and masks the values everywhere they could surface. This slice composes them; it introduces no new machinery and no dependency.

## Goals / Non-Goals

**Goals:**
- Reach pages behind a login, in tests and in the planner
- Support the shapes real projects actually use, without privileging one
- Authenticate once per run, not once per test
- Fail loudly and early when authentication does not work
- Treat the captured session as the credential it is

**Non-Goals:** credential storage, MFA/magic-link automation, multiple users or role matrices, mid-run session refresh.

## Decisions

### D1: All strategies converge on one artifact — a Playwright storage state
Whatever the shape of the login, the output is the same thing: cookies and origin storage that make a browser context authenticated. Making that the single internal contract means the rest of the system stays unaware of *how* the session was obtained — `run` and `plan` just receive a state to seed contexts with. Adding a fourth strategy later is a new producer of the same artifact, not a change to any consumer.

### D2: Three strategies, chosen by which field is present, exactly one allowed
```yaml
auth:
  steps: [...]                  # UI journey, executed once
  # or
  storage_state: path/to.json   # captured previously by a human
  # or
  headers: {...}                # and/or cookies: [...] — no browser needed
  verify: "..."                 # optional, any strategy
```
A `strategy:` discriminator field was rejected as redundant: the presence of `steps` already says what it is, and a discriminator that can contradict its own payload is a class of bug worth not having. Two strategies at once is a config error, caught at validation with a message naming both — silently preferring one would make a typo look like it worked.

Coverage rationale: `steps` handles form login and any flow a person could click through, which is the majority case and costs nothing new because the executor already does it. `storage_state` is the escape hatch for what cannot be automated honestly — SSO with MFA, magic links, hardware keys: a human logs in once, exports the state, and CI reuses it. `headers`/`cookies` covers token-based apps where driving a UI to authenticate would be theatre.

### D3: Authenticate once per run, reuse the state for every context
Authentication runs before the first test, and its storage state seeds every subsequent `browser.newContext({ storageState })`. Per-test login was rejected on cost alone — it is ~30s per test even against a trivial local app, so a 20-test suite would spend most of its wall clock logging in — and on signal quality: a login flake would then fail an unrelated test and send the reader to the wrong place.

Test isolation is preserved. Each test still gets a fresh context; that context merely starts from a known authenticated state rather than empty. Tests still cannot leak into each other.

### D4: `auth: false` per test, because the login test needs it
A suite that configures `auth:` and also has a "login succeeds" test would start that test already logged in, and it would fail — the app redirects an authenticated visitor away from the login form. So an opt-out is not a nicety, it is required for the configuration to be self-consistent. `auth: true` is the default; a test setting `auth: false` gets an empty context, exactly as today.

### D5: `verify` turns one failure into one message
Optionally, after authenticating, a plain-English expectation is judged against the resulting page (reusing `brain.judge`). Without it, a wrong password surfaces as every test failing on a login wall — N failures, none of which names the real cause. With it, the run stops before the first test with "authentication failed: <reason>". The cost is one extra LLM call per run, which is negligible next to being handed twenty misleading failures.

### D6: Authentication failure aborts the run with exit 2
A failed login is a configuration or environment problem, not a product defect, so it must not be reported as failing tests or fold into the score — a score of 0 because nobody could log in says nothing about the code under review. It exits 2, the code already reserved for usage and config errors, before any test executes.

### D7: The captured state is a credential
A storage state file contains live session cookies; anyone holding it is logged in as that user. So: it is written under `.blastproof/` and added to `.gitignore` by `init`; it is never printed, logged or embedded in a report; and `{{env.*}}` values inside `auth.steps` go through the same `SecretsMask` the runner already applies, so a password never reaches a log even when the login journey fails mid-way. The README states plainly that a captured state must not be committed.

### D8: The planner authenticates too
`plan` and `test` seed their contexts from the same state, which removes the known limitation that generated drafts describe the login wall. This is most of the practical value of the slice: it is what lets the planner see the actual feature.

### D9: Caching the state across runs is opt-in, and off
`auth.cache: true` reuses a previously captured state file instead of logging in again, trading freshness for speed. It defaults to **false** because a stale session produces the most confusing failure mode this feature can have — tests failing at random points because the session expired mid-run, with nothing pointing at the cause. Opt in when the login is slow and the session is long-lived.

## Risks / Trade-offs

- A wrong or expired session makes every test fail for the same invisible reason → Mitigation: `verify` (D5) plus abort-before-tests (D6); caching off by default (D9).
- A captured storage state is committed by accident → Mitigation: `init` gitignores it, the README says so explicitly, and the default path lives under the already-ignored `.blastproof/` tree.
- `steps` cannot survive MFA or a magic link → Accepted and answered by `storage_state` (D2); the README says which strategy to pick for which flow rather than leaving users to discover the wall.
- One session per run does not fit role-based products → Accepted for this slice; D1's single artifact is what makes a future per-test user additive rather than a redesign.
- An `auth` failure now blocks a run that previously would have executed → Correct behaviour, and only reachable by projects that opted into an `auth:` section.

## Migration Plan

Purely additive. Config without `auth:` behaves exactly as today, tests default to `auth: true` which is a no-op when no recipe is configured, and no existing suite changes meaning.

## Open Questions

(none — strategy set, session scope and failure behaviour follow from the goals above)
