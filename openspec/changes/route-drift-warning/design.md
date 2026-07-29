# Design: route-drift-warning

## Context

`selectImpactedTests` intersects `test.routes` with the diff's affected routes by exact equality — `/cart` and `/cart/` are distinct, so a test declaring the one no config mapping declares is never selected and never reported. The README tells users to "write them consistently"; `tests/selection.test.ts` codifies the drop as intended ("compares route strings by exact equality"). The information that a route can never be selected is nowhere on screen, so a mislabeled suite looks covered when it is not — the same silent false negative `--fail-on-unmapped` addresses on the file side, on the test side of the routes contract.

## Goals / Non-Goals

**Goals:**
- Make a test-declared route no mapping declares visible, without changing what matches
- Surface it where a keyless pre-flight already happens: `--dry-run` and the `--impacted` report
- Keep stdout machine-friendly and exit codes unchanged

**Non-Goals:** a failing gate, route normalization, fuzzy suggestions, detection in `config.ts`, surfacing on plain runs.

## Decisions

### D1: Detect, don't normalize
Normalizing `/cart/`↔`/cart` would change selection semantics and mask genuine differences, contradicting the documented exact-equality contract. Drift detection surfaces the problem without altering what matches.

### D2: Compute drift over the full parsed test set, not `selected`
A drifted test is precisely one that never gets selected, so checking `selectImpactedTests`'s `selected` would never fire. The single most important invariant.

### D3: Compare against the full declared route universe, not `affectedRoutes`
Drift is "no mapping declares this route at all", independent of the current diff. A route valid but absent from this diff is not drift. Comparison is against the union of all `routes:` mapping values.

### D4: Only run when config has at least one `routes:` mapping
A suite using `routes:` as metadata with no mappings must not be flagged on every route. Empty declared set → empty result.

### D5: Warning to stderr, non-fatal; surface in `--dry-run` and the `--impacted` report only
Matches `reportUnclassified`'s stderr pattern; keeps stdout machine-friendly; avoids cluttering plain runs. `--dry-run` (with or without `--impacted`) is the keyless pre-flight where this is most valuable.

### D6: Detection is a pure function in `selection.ts`; surfacing in `run.ts`
Mirrors `mapImpact`/`selectImpactedTests` separation: pure logic, unit-testable; the CLI decides where to print. Not in `config.ts` — tests are not loaded there.

### D7: Determinism — sort and de-dup
The codebase sorts everywhere (`affectedRoutes: [...affected].sort()`); drift output must be stable across runs.

## Rejected alternatives
- **A1 normalize** — changes selection semantics and masks genuine differences (D1).
- **A2 `--fail-on-route-drift` gate** — scope creep; the issue asks to warn. A gate mirroring `--fail-on-unmapped` is a follow-up.
- **A3 fuzzy/LLM "did you mean"** — breaks the keyless `--dry-run` pre-flight where this matters most.
- **A4 detect in `config.ts`** — tests are not loaded there; drift is a property of tests against config.
- **A5 surface only under `--impacted`** — drift is diff-independent; the `--dry-run` pre-flight is exactly where a mislabeled suite should be caught before any token is spent.

## Risks / Trade-offs
- Noise on suites that intentionally use `routes:` as free-form metadata with mappings → Mitigated by D4: no mappings, no detection. With mappings, an unlisted route is genuinely never selectable, so the signal is correct.
- A team may ignore standing warnings → Accepted; the warning is non-fatal and the gate (A2) is the follow-up for teams who want to enforce.
- Does not catch a route declared by config but mistyped in the test in a way that happens to match another mapping → True; drift is "declared by no mapping", not "mapped to the wrong route".

## Migration Plan
Additive. Without `routes:` mappings, detection is a no-op. Selection semantics, exit codes and stdout are unchanged; warnings go to stderr.

## Open Questions
(none)
