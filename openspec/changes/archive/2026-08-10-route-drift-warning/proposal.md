# Proposal: route-drift-warning

## Why

`--impacted` selects tests by exact-equality intersection of `test.routes` with the routes affected by the diff. A test declaring `/cart/` while config maps to `/cart` is silently never selected — the user believes they have coverage while a regression slips through. The README already warns users to "write them consistently" (`/cart` ≠ `/cart/` — write them consistently), which shifts a silent correctness footgun onto memory. `tests/selection.test.ts` already documents this drop as expected behavior (the "compares route strings by exact equality" test asserts a `/cart/`-declared test is never selected by an affected `/cart`).

A green `--impacted` run that silently ran nothing for a mislabeled route is the same class of false negative `--fail-on-unmapped` exists to prevent, on the test side of the routes contract: the gate says safe when it is not.

## What Changes

Add pure route-drift detection. When config declares at least one `routes:` mapping, any test-declared route that no mapping declares as a value is reported as drift — to stderr, in `--dry-run` and in the `--impacted` report. Non-fatal: exit codes and selection semantics are unchanged. No route normalization is applied.

## Capabilities

### Modified Capabilities

- `impact-mapping`: detect test-declared routes no `routes:` mapping declares (drift), over the full parsed test set, against the union of all declared route values
- `cli-run-command`: report drift to stderr in `--dry-run` and the `--impacted` report; non-fatal

## Impact

- New dependencies: **none**
- Affects: `src/runner/selection.ts` (pure `detectRouteDrift`), `src/commands/run.ts` (surfacing), `tests/`, README
- Additive: selection semantics, exit codes and stdout are unchanged; warnings go to stderr

## Non-goals

- No `--fail-on-route-drift` gate — the issue asks to warn; a gate mirroring `--fail-on-unmapped` is a follow-up
- No route normalization — contradicts the documented exact-equality contract
- No fuzzy/LLM "did you mean" suggestions — must work keyless in `--dry-run`
- No detection inside `config.ts` — tests are not loaded there
- No surfacing in plain (non-dry, non-impacted) runs — keeps run output clean
