# Proposal: refuse-an-inverted-routes-map

## Why

`routes:` is `{ glob: [route, ...] }` — the file glob is the key. Written the other way round, `{ "/cart": ["src/cart/**"] }`, it still type-checks: both halves are a string keying a list of strings, so `z.record(z.array(z.string()))` accepts it and `loadConfig` returns happily.

Then nothing matches. Every changed file is compared against `/cart` as though it were a glob, falls through to unclassified, and `--impacted` selects zero tests. The run **exits 0** having exercised nothing, and the report is indistinguishable from a diff that genuinely affected no page. `--fail-on-unmapped` would catch it, but it is opt-in and fires only after the run has already started.

Inverting it is not carelessness. The key is named `routes`, and a test file's own `routes:` genuinely *is* a list of routes (`src/runner/testfile.ts:17`) — the same word means the opposite thing one file away, and both files are edited in the same sitting.

This is the same class as `--fail-on-unmapped` and the route-drift warning: a gate that reports safe when it is not. Issue #6.

## What Changes

`loadConfig` refuses a `routes:` map whose entries are inverted, with an error naming the offending entry and showing the correction. Detection is a heuristic over the shape of each entry, requiring **both** halves to look wrong before it accuses.

## Capabilities

### Modified Capabilities

- `impact-mapping`: an inverted `routes:` entry is refused at config load with an actionable error, rather than parsed into a map that matches nothing

## Impact

- New dependencies: **none**
- Affects: `src/config.ts` (detection + schema refinement), `src/commands/init.ts` (scaffold comment), `tests/config.test.ts`, README, `docs/configuration.md`
- **Not additive**: a config that loaded before and matched nothing now exits 2. No config that ever selected a test changes behaviour, but the exit code for this input does — this is a minor bump, not a patch, by the definition `CHANGELOG.md` states

## Non-goals

- No auto-correction. Swapping the entry silently is exactly what `src/config.ts:84` already refuses to do for auth strategies: "Silently preferring one would make a typo look like it worked."
- No detection of inversion whose keys carry no leading slash — indistinguishable from a valid map by any rule
- No change to `impact.ts`, to matching, or to what an accepted map means
- No warning-only mode or opt-out flag
