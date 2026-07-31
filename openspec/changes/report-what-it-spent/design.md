## Context

`RunBudget` already holds everything needed. `record(usage)` runs after every model call, incrementing `calls` and adding `usage.totalTokens` when it is present. `callCount` and `tokenCount` are already exposed. At the end of a run the object goes out of scope and the numbers go with it.

`--dry-run` prints `estimateMaxModelCalls`, a worst case of `steps × (N + R + min(N, R))`. For the dogfood suite that is 735 calls. A real run of the same suite spends a small fraction of it. Both numbers are correct; only one of them is useful for sizing a budget, and it is the one we do not print.

## Goals / Non-Goals

**Goals:**
- A run says what it spent.
- An interrupted run says it too.
- A pipeline can read it without parsing stdout.

**Non-Goals:**
- Currency. Calls and tokens are what we know.
- Per-test attribution, or an input/output split.

## Decisions

### D1 — Zero tokens and unknown tokens are different, and must read differently

**Decision.** `RunBudget` additionally counts how many calls reported usage at all. The summary distinguishes three cases:

- no call reported usage → the tokens figure is stated as unavailable, naming the provider as the reason
- every call reported usage → the total, plainly
- some did → the total, qualified by how many calls it covers

**Why this is not over-engineering for a rare case.** `CallUsage.totalTokens` is optional because it genuinely is optional: local providers routinely omit it. `tokenCount` is initialised to `0` and only ever incremented by a defined value, so a run against such a provider ends with `tokens: 0` — indistinguishable from a run that made no calls. Printing `0 tokens` there is not a rounding error, it is a false statement about the thing someone is reading the line to learn. The partial case is unlikely but costs one comparison to be honest about, and this project has been bitten before by numbers that were technically derived and practically wrong.

### D2 — The command that created the budget is the one that reports it

**Decision.** `run` and `plan` report the spend only when they constructed their own `RunBudget`. When a composing caller handed one in (`options.budget`), that caller reports.

**Why.** `test` deliberately creates one budget and passes it to both phases, because a budget that resets between phases is two allowances rather than one bound. Reporting at the point of use rather than the point of ownership would print the running total twice for a single allowance, with the second line silently including the first. Tying the report to ownership makes "reported once per allowance" true by construction rather than by remembering — the same reasoning that made the budget itself a single object rather than a check at each call site.

### D3 — Report the spend before the score, and always

**Decision.** The spend line is printed for every completed run, including a run stopped by its own budget or deadline, and it sits with the summary rather than being hidden behind a flag.

**Why for an interrupted run especially.** A stop already prints which limit was hit and its configured value. What it does not print is the rest of the picture: a run stopped on tokens still spent calls, and someone deciding whether the limit was too tight needs both. This is the case where the number is least guessable and most needed.

**Why not behind a `--report-usage` flag.** A number the tool already has, that costs one line, does not need opting into. Anyone who does not care skips a line; anyone who does would otherwise have to know the flag exists.

### D4 — Against the limits, when there are limits

**Decision.** When a limit is configured, the line names it: `142 of 500`. When none is, the bare figure.

**Why.** The figure alone answers "what did this cost". The figure against the limit answers "how close am I", which is the question someone who has already configured a budget is asking. Printing `of unlimited` for the unconfigured case would be noise.

## Risks / Trade-offs

- **The token total is only as good as the provider's reporting.** We report what we were told, and say when we were told nothing. Nothing here reconciles against a provider's own billing, and the release notes should not imply it does.
- **One more line of output on every run.** Accepted; it is one line, and the alternative is a flag nobody discovers.
- **Two report surfaces gain a field.** JUnit and HTML both take the same numbers from the same object, so they cannot disagree with the console unless someone computes them separately, which is why the summary is produced by `RunBudget` itself rather than by each caller.

## Migration Plan

None. Output gains a line, JUnit gains two properties. Nothing existing changes shape, so a pipeline parsing the score property is unaffected.

## Open Questions

None blocking. Noted: `CallUsage` records only `totalTokens`, so an input/output split is not available to report even though most providers return one. Widening it is a separate change with its own reason to exist.
