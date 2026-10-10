# Design: no-score-when-nothing-ran

## D1. Decided in `finalize`, not in `computeScore`

`computeScore` cannot tell an empty selection from an interrupted run: both arrive as zero executed weight. `finalize` holds `incomplete`, so it decides. `computeScore` stays pure and unchanged, and a new `scoreOf(results, incomplete)` (in `score.ts`, beside the other rules) returns `undefined` when the run is incomplete and no result has a status other than `not-run`. The reports take `score: number | undefined`, so the type checker finds every site that read the number.

## D2. Absent, not a sentinel

The JUnit report omits the property rather than writing `-1`, `NaN` or an empty value. `action.yml` already greps `value="[0-9]+"` and writes an empty output when nothing matches, and its description already calls empty "no score". A sentinel would be a number a careless pipeline compares.

## D3. What each surface says

- Console: `Score: none (no test executed before the stop)` in place of `Score over executed tests: 100 …`, under the existing `Run incomplete:` line.
- HTML: the score block shows `—` with "no score: no test executed", and no gate verdict, since there is nothing to hold against the threshold.
- JUnit: no `score` property. `incomplete` and `incomplete_reason` stay.
