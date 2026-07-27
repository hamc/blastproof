# Proposal: unmapped-gate

## Why

A changed file that matches no `routes:` glob contributes no affected routes. When every changed file is unmapped, nothing is selected, the score is 100 because nothing executed, and the gate passes — so a change to a shared module that breaks every price in the application merges with a green check. The information is on screen ("Unmapped files"), but a green run is not read. This is a false negative on a merge gate: the gate says safe when it is not, which is the failure that costs the most trust.

## What Changes

- Add an optional `ignore:` glob list to `.blastproof/config.yaml` for files knowingly irrelevant to any route (docs, licences, CI config, the test suite itself)
- Changed files matching `ignore:` are no longer reported as unmapped, which also removes standing noise from every run's output
- Add `run --fail-on-unmapped` and `test --fail-on-unmapped`: exit 1 when any changed file is neither mapped to a route nor ignored
- The failure message names the unclassified files and states the two ways to resolve them — map them in `routes:` or declare them irrelevant in `ignore:`
- `init` scaffolds a commented `ignore:` block with the usual suspects

## Capabilities

### Modified Capabilities

- `impact-mapping`: `ignore:` globs and the resulting three-way classification of a changed file — mapped, ignored, or unclassified
- `cli-run-command`: the `--fail-on-unmapped` flag and its effect on the exit code
- `cli-test-command`: the same flag, composed into the pipeline

## Impact

- New dependencies: **none**; `picomatch` already evaluates the `routes:` globs
- Affects: `src/config.ts`, `src/impact.ts`, `src/commands/run.ts`, `src/commands/test.ts`, `src/cli.ts`, `src/commands/init.ts`, `tests/`, README
- Additive: without the flag, exit codes are unchanged; without `ignore:`, classification behaves as today

## Non-goals

- No implicit default ignore list: a file nobody has classified is exactly the risk this slice exists to surface, and shipping silent defaults would hide the first files a user should think about
- No inference of impact from imports or the module graph — the real answer for shared modules, and a much larger change
- No config-level `fail_on_unmapped`; it stays a flag, like `--min-score`
- No change to how the score is computed: unmapped files are a coverage signal, not a test outcome
