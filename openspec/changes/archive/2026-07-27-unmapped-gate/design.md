# Design: unmapped-gate

## Context

`mapImpact` classifies each changed file two ways: it matches a `routes:` glob and contributes routes, or it does not and is reported as unmapped. Unmapped files never fail anything, which is right as a default — an incomplete map should not punish the user. But combined with the score's "nothing executed scores 100" rule (m3a D2), it produces a merge gate that approves a change nobody tested. Demonstrated: a diff touching only `src/lib/money.ts` reports the file as unmapped, affects no route, scores 100 and exits 0.

## Goals / Non-Goals

**Goals:**
- Turn "no one has said what this file affects" into a signal a CI can act on
- Keep that signal meaningful enough that nobody switches it off
- Leave the default behaviour unchanged

**Non-Goals:** import-graph impact, implicit ignore defaults, score changes, config-level enablement.

## Decisions

### D1: A blunt flag would be turned off on day one, so the slice is really the `ignore:` list
`--fail-on-unmapped` alone would fail on every README edit, every workflow tweak, every change to the test suite. A gate that fires on noise gets disabled, and a disabled gate protects nothing — so the flag on its own would be worse than the status quo, because it would look like the problem was addressed.

The fix is to make "unmapped" mean something sharper. Three classifications instead of two:

| a changed file | means |
| --- | --- |
| matches a `routes:` glob | contributes affected routes |
| matches an `ignore:` glob | knowingly irrelevant to any route |
| matches neither | **unclassified — nobody has said what this affects** |

Only the third fails. That is a signal worth acting on, because it is exactly the risk: a file whose blast radius no one has considered.

### D2: No implicit default ignore list
It is tempting to ship `**/*.md`, `.github/**` and friends as defaults so the first run is quiet. Rejected: those defaults would silently classify files on the user's behalf, and the whole point is that classification is the user's risk model, not ours. A default that guesses wrong is invisible; a first run that names `README.md` and asks you to decide is instructive, and it takes one line to resolve. `init` scaffolds a commented block with the usual candidates, so the cost is copying a comment, not inventing a list.

### D3: Ignored files disappear from the unmapped report, not just from the gate
`ignore:` filters the reported unmapped list whether or not the flag is set. Reporting `README.md` as unmapped on every single run is standing noise, and standing noise is how the genuinely interesting line — `src/lib/money.ts` — gets skimmed past. The report improves for everyone, and the flag then gates on exactly what the report shows.

### D4: The flag adds a reason to fail; it does not replace one
`--min-score` deliberately *replaces* the all-must-pass rule (m3a D4), because a threshold that only added a reason could never bind. `--fail-on-unmapped` is the opposite case: it is about coverage classification, not test outcomes, so it is orthogonal and always binds. A run can pass its score gate and still fail here — correctly, because "the tests I ran all passed" and "something changed that nobody has classified" are different claims. Both use exit 1: to CI they mean the same thing.

### D5: The message must state both ways out
An error that only says "unclassified files found" leaves the user guessing whether to write a glob, an ignore rule, or a test. The message names the files and both resolutions — map it in `routes:` or declare it irrelevant in `ignore:` — because the decision is theirs and either answer is legitimate.

### D6: Classification is computed where mapping already happens
`mapImpact` gains the ignore list and returns `unmappedFiles` already filtered, plus the ignored count for reporting. It stays pure and stays the single place a changed file is classified, so `run`, `plan` and `test` cannot disagree about what unmapped means.

## Risks / Trade-offs

- Teams paper over the signal with a broad `ignore: ["**"]` → Mitigation: none technical, and none attempted. A team determined to disable a safety check will; the value is in making that an explicit, reviewable line in a config file rather than a silent default.
- The first run with the flag fails on housekeeping files → Intended (D2), and resolved once by copying the scaffolded block.
- Over-broad `routes:` globs still hide the problem, since a file matched by `"src/**"` counts as mapped → Accepted: that is the same trade-off m2a documented, and `--dry-run` makes glob quality visible.
- This does not detect a shared module whose blast radius is wider than its glob says → True and worth stating: it catches *unclassified*, not *misclassified*. Import-graph impact is the answer to the second, and is out of scope.

## Migration Plan

Additive. Without the flag, exit codes are unchanged. Without `ignore:`, classification is exactly as today. Existing configs need no edit.

## Open Questions

(none)
