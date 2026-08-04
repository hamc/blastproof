# Tasks: route-drift-warning

## 1. Detection (pure)
- [x] 1.1 Add `detectRouteDrift(tests, declaredRoutes)` (plus `RouteDriftEntry`/`RouteDriftResult` types) to `src/runner/selection.ts`: exact-equality comparison against the union of declared routes; empty declared set → empty result; per-test sort + de-dup (D1–D7). Do not modify `selectImpactedTests`.
- [x] 1.2 Unit tests in `tests/selection.test.ts` for trailing-slash drift, typo drift, no-drift, empty declared set, empty test routes, dedup+sort, multiple tests in input order, and "route valid but absent from diff is not drift".

## 2. Surfacing
- [x] 2.1 In `src/commands/run.ts`, add `declaredConfigRoutes(config)` (sorted, de-duped union of `routes:` values) and `printRouteDrift(drift, cwd)` to stderr.
- [x] 2.2 Compute drift once after the parse loop and print it from a single unconditional `printRouteDrift` call covering every path — plain `run`, `--dry-run`, and `--impacted`. Drift is no longer threaded into `printDryRun`/`printImpactReport`; the two old call sites and the `if (!options.dryRun)` guard are removed so a future code path cannot silently drop the warning. Exit codes unchanged.
- [x] 2.3 Tests in `tests/run.test.ts` for `--impacted --dry-run` drift, `--dry-run`-only drift, plain-`run` drift, no-drift, and no-`routes:`-mappings. Do not break the existing dry-run or `--fail-on-unmapped` tests.

## 3. Spec & docs
- [x] 3.1 Spec deltas under `openspec/changes/route-drift-warning/specs/{impact-mapping,cli-run-command}/spec.md`.
- [x] 3.2 README: one sentence after the "write them consistently" line. CHANGELOG dropped per maintainer request (changelog is now written at release time, not in PRs).

## 4. Verification
- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` all green.
