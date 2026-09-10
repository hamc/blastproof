# Proposal: name-what-the-diff-did-not-see

## Why

`--impacted` selects from `git diff <base>...HEAD`. Uncommitted work is invisible to that comparison, so a run against a dirty working tree reports no affected routes, selects nothing, and exits 0 — never mentioning that there were changes it did not look at (#99).

Reproduced here, where `examples/demo-app/login.html` maps to `/login`:

```
$ echo "<!-- probe -->" >> examples/demo-app/login.html
$ blastproof run --impacted --dry-run
Affected routes: none
Dry run: 0 test(s) selected
```

`--fail-on-unmapped` cannot catch it either — exit 0 with the flag on — because the guard inspects the changed files the hole already excluded it from. The net is downstream of the gap.

This is the shape 0.18.0 closed twice (#76, #72): a gate reporting safe having looked at nothing. It is worse than either, because it fails where a person trusts it most — locally, before committing, to check whether their change broke something.

## What Changes

- Wherever the diff is computed, the working tree SHALL be inspected too, and every change the diff excluded SHALL be named, together with the routes it maps to
- It is a **warning**: no exit code, selection or gate changes. What `--impacted` runs is what it ran before
- Two classes stay silent, deliberately: a file the config's `ignore:` already declares irrelevant, and a file already in the diff — its routes are selected either way

## Capabilities

### Modified Capabilities

- `diff-analysis`: the diff names the work it excluded, so "nothing affected" cannot be read as "nothing was looked at"

## Impact

- New dependencies: **none** — `simple-git` already exposes status (13 ms measured on this repo), `mapImpact` already classifies a file into routed / ignored / unclassified
- Affects: one function in `src/diff.ts`, one printer, the two places the diff is computed (`run`, `plan`), and their tests
- CI is untouched in practice: `actions/checkout` produces a clean tree, so it never fires there. All of its value and all of its noise land on a developer's machine, which is where the defect is
- It fires on this repository on the first run: `.tool-versions` is untracked and matched by no glob in our own config

## Non-goals

- **The working tree does not become selectable.** Whether `--impacted` should select from it is #99's second half and a genuine decision: CI must keep comparing commits, and a local run that silently widened its selection would swap one surprise for another
- **`--fail-on-unmapped` is untouched.** Making this fatal is the same deferred decision
- **No new flag, no new config key.** A warning that has to be switched on does not fix a silence
- **Not a new line in the impact report.** #39 counts six words there for things that were not covered; this one goes to stderr beside the route-drift warning, which is where diff- and selection-independent facts already live
