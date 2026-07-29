# Defects

## DEF-001 — Dry-run ceiling (`estimateMaxModelCalls`) can undershoot the true worst-case call count
- Status: CLOSED
- Severity: HIGH (breaks a requirement)
- Found by: qa
- Steps: numbered, from a clean state, with exact commands
  1. In `/home/heitor/blastproof`, note two constants that determine one test step's real worst-case model-call count in `src/runner/executor.ts`:
     - `DEFAULT_MAX_ITERATIONS_PER_STEP = 15` (`N`), hardcoded, not configurable anywhere (no CLI flag, no config field).
     - `config.max_retries_per_step` (`R`), a user-configurable value in `.blastproof/config.yaml` (`z.number().int().min(1)`, default 3, **no upper bound**, and not required to relate to `N` in any way).
  2. In `src/runner/executor.ts`'s per-step loop (`executeTest`), a malformed/invalid model response (`brain.nextAction` throwing) increments `failedAttempts` (the retry budget, capped at `R`) but does **not** increment `iterations` (the cap checked against `N`). A failing `assert` judgment increments both `iterations` and `failedAttempts` and costs two real model calls (`nextAction` + `judge`). This means the real worst-case number of model calls for one step is `N + R`, not `2N` as `estimateMaxModelCalls` (`src/runner/budget.ts`) computes (`totalSteps * maxIterationsPerStep * 2`).
  3. `2N > N + R` only holds while `R <= N` (true only for the *default* `max_retries_per_step: 3` vs. the fixed `N=15`). Setting `max_retries_per_step` above 15 in config — a perfectly legal value per the zod schema — makes `N + R > 2N`, i.e. the real ceiling exceeds the reported one.
  4. Reproduced empirically (script run outside the repo, against unmodified `src/runner/executor.ts` and `src/runner/budget.ts`, no product code edited): a single-step test executed via `executeTest` with `maxIterationsPerStep = 15` and `maxRetries = 20`, driven by a scripted brain that (a) returns malformed output `R-1=19` times, (b) then returns `N-1=14` plain successful actions, (c) then one `assert` action whose judgment always fails (the step's final, terminating call) — produced **35** real model calls (34 `nextAction` + 1 `judge`), while `estimateMaxModelCalls([{steps:['single step']}], 15)` reports a ceiling of **30**.
- Expected: per spec `run-budget`, "Scenario: Estimate is an upper bound, not a prediction" — the dry-run number must be "the ceiling the selection cannot exceed" (design D5). A real run must never spend more model calls than the number `--dry-run` reported.
- Actual: with a legal (if unusual) `max_retries_per_step` value greater than the fixed 15-iteration cap, a real run can spend more model calls than the reported ceiling — the estimate undershoots, which design D5 and the task itself single out as strictly worse than reporting no ceiling at all ("an estimate that undershoots is worse than none").
- Evidence: empirical repro script executed via `npx tsx` against the unmodified `src/runner/executor.ts` / `src/runner/budget.ts` (script and its output not persisted in the repo, per QA's read-only scope; output captured below):
  ```
  N (maxIterationsPerStep, fixed default) = 15
  R (config.max_retries_per_step, user-configurable, e.g. 20) = 20
  step status: failed / reason: forced failure to consume the last retry unit
  nextAction calls: 34
  judge calls: 1
  TOTAL real model calls made: 35
  estimateMaxModelCalls() ceiling for this 1-step test: 30
  DEFECT CONFIRMED: real calls (35) EXCEED the reported ceiling (30)
  ```
  Formula for anyone who wants to reproduce without the script: true per-step worst case is `maxIterationsPerStep + max_retries_per_step` (not `maxIterationsPerStep * 2`); the two diverge, in the estimate's favor being wrong, exactly when `max_retries_per_step > maxIterationsPerStep` (i.e. > 15, since `maxIterationsPerStep` has no config/flag and is fixed at `DEFAULT_MAX_ITERATIONS_PER_STEP`).
- History: 2026-07-29 filed by qa
- History: 2026-07-29, dev: changed `estimateMaxModelCalls` (`src/runner/budget.ts`) from `totalSteps * maxIterationsPerStep * 2` to `totalSteps * (maxIterationsPerStep + maxRetriesPerStep)`, matching the `N + R` formula this report derived; `maxRetriesPerStep` is now a required parameter read from `config.max_retries_per_step` at the one call site (`src/commands/run.ts`'s `printDryRun`) instead of being unstated/assumed. Also included `auth.steps`' step count in the ceiling when a login journey is configured, since `authenticate()` spends model calls through the same `executeTest` loop before any test runs and was previously excluded — README/CHANGELOG updated to say so. Added a regression test (`tests/budget.test.ts`, "DEF-001 regression") that drives the real executor adversarially with `R > N` and asserts the ceiling is `>=` (in fact exactly equal to) the actual call count; updated `tests/run.test.ts`'s dry-run expectations to the new numbers and added a case covering the auth-journey inclusion. Left for qa to verify and close.
- History: 2026-07-29, qa: retested and CLOSED.
  - Re-derived the bound independently via LP over the three ways a model call can spend against the two budgets (standalone malformed retry, plain successful action, failing/passing assert) and got exactly `N + R` in every regime, including the "N-1 failing asserts + 1 passing assert" boundary the dev flagged — confirmed that scenario only reaches `2N` calls when `R >= N`, at which point `N + R = 2N`, so it never exceeds the new ceiling.
  - Empirically drove the real, unmodified `executeTest` (no product code edited) adversarially across 7 `(N, R)` pairs spanning `R > N`, `R < N`, `R == N`, `R == 1`, and `N == R == 1`, using the LP-optimal schedule for each regime (script: `/tmp/claude-.../scratchpad/verify-def001.mts`, not part of the repo). Result: actual calls equalled `N + R` exactly in all 7 cases (tight, not just bounded), and the old `2N` formula was violated in exactly the 3 cases where `R > N` (matching the DEF-001 repro), never in the other 4 — confirming `N + R` is a genuine, regime-independent upper bound and not a formula that merely happens to fit the one case tested.
    ```
    N=1  R=1   actual=2   new(N+R)=2   HOLDS   old(2N)=2   holds   tight=true
    N=3  R=5   actual=8   new(N+R)=8   HOLDS   old(2N)=6   VIOLATED tight=true
    N=5  R=5   actual=10  new(N+R)=10  HOLDS   old(2N)=10  holds   tight=true
    N=1  R=20  actual=21  new(N+R)=21  HOLDS   old(2N)=2   VIOLATED tight=true
    N=15 R=20  actual=35  new(N+R)=35  HOLDS   old(2N)=30  VIOLATED tight=true
    N=15 R=3   actual=18  new(N+R)=18  HOLDS   old(2N)=30  holds   tight=true
    N=15 R=1   actual=16  new(N+R)=16  HOLDS   old(2N)=30  holds   tight=true
    ```
  - Confirmed `tests/budget.test.ts`'s "DEF-001 regression" test (N=3, R=5) would genuinely fail against the old formula: it asserts `ceiling >= actualCalls`, and old-formula `ceiling = totalSteps * N * 2 = 6 < actualCalls = 8` — a real, non-vacuous regression guard, not one that passes either way. Verified by inline computation against the unmodified `executeTest` (see table above, same N=3/R=5 row), without editing `src/runner/budget.ts`, per QA's read-only scope on product code.
  - Confirmed auth inclusion is correct: `src/config.ts`'s `authSchema` enforces exactly one of `steps` / `storage_state` / `headers`+`cookies` (mutually exclusive, `superRefine`), so `config.auth?.steps` being non-empty in `printDryRun` correctly predicts that `authenticate()` (`src/auth.ts`) will take the `fromSteps` branch, the only one that calls `executeTest` and spends model calls — `fromStorageState`/`fromStatic` spend zero. The printed `", including the login journey"` suffix appears exactly when `auth.steps` is configured, never otherwise, so it never overclaims coverage. (Note: `auth.cache` with a valid cached session skips `fromSteps` even when `steps` is configured, making the ceiling an overcount in that case — safe, since a ceiling may overcount, never undercount.)
  - `grep` confirms `estimateMaxModelCalls` has exactly one call site (`src/commands/run.ts`'s `printDryRun`); `src/commands/plan.ts` and `src/commands/test.ts` don't call it directly (`test.ts` composes `runCommand`, going through the same fixed path). `runOne` passes `maxRetries: config.max_retries_per_step` to `executeTest` and no `maxIterationsPerStep` (so it defaults to `DEFAULT_MAX_ITERATIONS_PER_STEP`), matching exactly what `printDryRun` estimates against — no CLI flag or env var overrides `max_retries_per_step` outside `loadConfig`'s merge, so there is no path where a real run's caps diverge from what was printed. `grep` for the old `* 2` formula found no stale references anywhere in `src/` or the docs.
  - Verification suite: `npm run build` — success (tsup, ESM, no errors). `npm run typecheck` — clean, no output/errors (`tsc --noEmit`). `npm test` — `Test Files 24 passed (24)`, `Tests 311 passed (311)`.
  - E2E: not run for this defect (it is a pure dry-run/arithmetic check exercised via `executeTest` directly and the existing test suite; local Chromium E2E remains blocked by missing system libs, pre-existing, orthogonal to this defect).
