# Design: m3a-score-and-junit

## Context

M1 built the runner, M2 the diff-driven selection (`run --impacted`) and generation (`plan`). Both end at a console table. This slice adds the two artifacts a CI needs to act on a run: a score that can be compared against a threshold, and a JUnit XML file that CI systems already know how to render. `TestResult` (`runner/executor.ts`) already carries `priority`, `status`, `durationMs`, `failedStep`, `reason` and `screenshot`, all masked of secrets at the executor boundary, so both new modules are pure functions over data that already exists.

## Goals / Non-Goals

**Goals:**
- Priority-weighted score, 0–100, printed on every run
- `--min-score <n>` gate that fails the run when the score is below the threshold
- JUnit XML written to `.blastproof/reports/<session>/junit.xml` or an explicit path
- Skipped-unrouted tests visible in the XML rather than silently absent

**Non-Goals:** HTML report, `blastproof test` composite, configurable weights, coverage-based deductions, GitHub Action.

## Decisions

### D1: Score is a weighted pass rate over executed tests
`score = round(100 × Σ weight(passed) / Σ weight(executed))` with `weight(P0)=3, weight(P1)=2, weight(P2)=1`. Only tests that actually ran are in the denominator: tests filtered out by `--tag`/`--priority`/`--query`, and tests skipped as unrouted under `--impacted`, are not failures and must not move the number. Weighting by priority is what makes the score meaningful — a failing P0 costs three times a failing P2, so a suite of trivial passes cannot hide a broken critical journey.

Rejected: an unweighted pass percentage (treats a checkout failure like a tooltip failure); averaging per-test partial credit from step counts (a test that fails on step 4 of 5 has still failed — partial credit would inflate confidence exactly where it is least warranted).

### D2: An empty selection scores 100
When no test executed, the sum is `0/0`. This slice defines that as **100**, not 0 and not an error. `run --impacted` on a docs-only PR selects nothing, and blocking that merge because "the score is 0" would be wrong — nothing was at risk and nothing broke. The console states it explicitly ("no tests executed") so the number is never mistaken for verified quality.

### D3: A broken test file counts as a failure
`runCommand` already turns an unparseable YAML file into a failed `TestResult` with priority P1. It stays in the score denominator as a failure: a test file that cannot run is a real regression in the suite, and silently excluding it would let a syntax error raise the score.

### D4: `--min-score` replaces the all-must-pass rule, it does not stack with it
Any failure already drops the score below 100 and already exits 1, so a threshold that only *added* a second reason to fail could never bind — it would be dead configuration. `--min-score <n>` therefore **takes over** the pass/fail decision: with the flag, the run passes when `score >= n`; without it, the existing rule stands unchanged (any failed test exits 1). This makes the flag a deliberate tolerance knob — `--min-score 80` lets a failing P2 through while still blocking a failing P0 — and `--min-score 100` reproduces today's strict behavior exactly.

The gate reuses exit code 1 rather than introducing a third value: a failing test and an insufficient score mean the same thing to CI, do not merge. Exit 2 stays reserved for usage/config errors.

Rejected: making the threshold purely additive (never binds, as shown above); a separate `--allow-failures` flag (two knobs expressing one intent, and it ignores priority — the whole point of weighting).

### D5: `--junit [path]` with a session-directory default
An optional-argument flag: `--junit` alone writes `.blastproof/reports/<session>/junit.xml` (consistent with where screenshots already go, per AGENTS.md), `--junit <path>` writes exactly where CI wants it. Requiring a path every time would make the common local case verbose; writing the file unconditionally would litter every run with an artifact most local runs do not want. Parent directories are created as needed.

### D6: XML is emitted directly, and escaped at one choke point
JUnit is a small, stable element set (`testsuite`, `testcase`, `failure`, `skipped`); a dependency for it would not survive the AGENTS.md justification bar. All interpolated text passes through a single `escapeXml` helper covering `& < > " '` — summaries, failure reasons and step text are model- and user-authored, so any of them can contain characters that would produce invalid XML. Values are already secret-masked upstream, so the report inherits masking rather than re-implementing it.

### D7: Result-to-case mapping
One `<testsuite name="blastproof">` per run; one `<testcase>` per test, `classname` = repo-relative file path, `name` = summary, `time` = seconds. A failed test carries `<failure message="<reason>">` whose body names the failing step; a test skipped as unrouted carries `<skipped message="no routes: declared"/>`. Suite attributes report `tests`, `failures`, `skipped` and total `time`. The score rides along as a `<property name="score">` so a CI parser can read it without scraping stdout.

### D8: Score and report are pure functions
`computeScore(results)` and `renderJUnit(results, skipped, meta)` take data and return a number / a string; only `runCommand` touches the filesystem. This keeps both unit-testable without a browser, an LLM or a temp directory, matching how `impact.ts` and `selection.ts` are already structured.

## Risks / Trade-offs

- A high score with low coverage reads as safety → Mitigation: the uncovered-routes report from m2a stays on screen next to the score, and `<skipped/>` cases surface unrouted tests in CI; the coverage question is deliberately a separate signal (proposal non-goal).
- `--min-score 100` makes any flake block merges → Mitigation: documented; the agentic executor's self-healing retries already absorb transient failures before a test is marked failed.
- Fixed weights will not fit every team → Mitigation: the formula is one pure function with the weights in one place, so making them configurable later is additive and needs no redesign.
- Empty selection scoring 100 could mask a misconfigured `routes:` map that never matches anything → Mitigation: the affected-routes and unmapped-files report already makes an empty match visible, and `--dry-run` exists to tune globs.

## Migration Plan

Additive. Existing `run` behavior and exit codes are unchanged when neither flag is passed; the only unconditional change is the score line added to the summary.

## Open Questions

(none — slicing, score formula and the placement of `blastproof test` were settled before this proposal)
