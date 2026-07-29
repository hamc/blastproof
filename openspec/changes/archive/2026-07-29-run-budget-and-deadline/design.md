## Context

Nothing bounds a run. `runCommand` loops over the selection, `executeTest` spends up to `maxIterationsPerStep` model round-trips per step, and no counter exists anywhere. The AI SDK returns `usage` on every call in `src/llm/brain.ts`; we discard it.

This is not a theoretical exposure. Measuring #15 exhausted the provider's credit mid-sequence, and ten runs then died at the first step with `requires more credits`. The failure mode arrived from outside, in the least useful form: partway through, with no partial accounting and no warning.

## Goals / Non-Goals

**Goals:**
- A run cannot spend without limit, and the limit is enforced where every call already passes.
- An interrupted run is unmistakably incomplete, in the exit code and in both reports.
- The ceiling of a selection is knowable before spending anything.

**Non-Goals:**
- Worker parallelism. Different change, different risks; #2 stays open for it.
- Currency. See D1.
- Per-test or per-step budgets — the run is the unit that has to survive.
- Provider retry or backoff.

## Decisions

**D1 — The budget counts calls and tokens, not money.**

Denominating in dollars requires a price table keyed by model and provider. It would be wrong the day a provider changes pricing, wrong for anyone routing through a gateway, and wrong in a way nobody notices until the cap fails to bind. A limit that silently stops meaning what it says is worse than no limit, because it is trusted.

Calls and tokens are exact, already reported, and provider-agnostic. Someone who wants a dollar figure can compute it from their own rates, with numbers that are actually true. Rejected: a built-in price table; an estimate-only warning with no enforcement.

**D2 — Enforcement lives in `createBrain`, not at the call sites.**

Every model call in the product — agent action, assert judgment, planner — goes through the `generate` wrapper in `src/llm/brain.ts`. The budget wraps that one function and is therefore total by construction: a future command that starts prompting cannot forget to be counted.

This is deliberately the same shape as the run-wide secrets mask, and for the same reason. The recurring defect in this codebase has been implementing a guarantee at a call site instead of defining it over a scope — it produced three rounds of secret leaks, and it produced #15. A budget checked in `runCommand`'s loop would miss the planner and every future caller.

**D3 — Exhaustion ends the run; it does not fail a test.**

A budget stop says nothing about the application under test. Recording it as a step failure would manufacture a defect that does not exist, and a red test that means "we ran out of quota" is worse than useless in review.

So exhaustion raises a distinct condition that unwinds the run, and unexecuted tests are recorded as **not run** — a third state, separate from passed and failed.

**D4 — An incomplete run can never report success, and `--min-score` does not override it.**

The tests that finished are a biased sample: they are the ones that came first, not the ones that mattered. Scoring on them and passing the gate would be a false green produced by running out of money.

This is the same reasoning that rejected the `fail`-to-`done` downgrade in `assertion-ends-step`: a gate that approves on incomplete evidence is worse than one that blocks. So an incomplete run exits non-zero unconditionally, and the threshold does not apply.

**D5 — The dry-run estimate is a ceiling, not a forecast.**

Worst case is computable exactly: steps × the per-step iteration ceiling, plus judgments. A predicted average would require usage history we do not have and would be wrong per app. A ceiling is honest, deterministic, and is the number someone sizing a budget actually needs. It must be labelled as the maximum, or it will be read as an estimate and mistrusted when the real run costs a fraction of it.

## Risks / Trade-offs

- **The token count trails by one call** — tokens are known only after a call returns, so the last call can cross the line. Mitigation: check before each call and stop when the *next* call could exceed; accept overshoot bounded by one call. Documented rather than hidden.
- **A budget set too low turns a healthy suite red** → mitigation: the message names the limit and the observed count, and `--dry-run` reports the ceiling so the number can be chosen from evidence rather than guessed.
- **`not run` is a third state and touches both reports plus scoring** → this is the bulk of the work and the likeliest place for a defect. Scoring must exclude unexecuted tests from the denominator rather than treat them as failures, or the score becomes a second, quieter lie.
- **Wall-clock checks are not preemptive** — a single hung page action can exceed the deadline. Playwright's own timeouts bound that; the deadline is checked between calls and between tests, not by interrupting in-flight work.

## Migration Plan

Additive and inert by default: absent config and flags, no limit binds and existing suites behave exactly as now. Rollback is reverting.

Verification cannot be unit tests alone, given #15's lesson. Closure requires a dogfood run with a deliberately tiny budget, confirming the run stops, exits 1, reports incomplete, and names the limit — plus an ordinary run confirming an unconfigured budget still does not bind.

## Open Questions

- Should a warning appear as the budget nears exhaustion (say 80%), or only at the stop? Leaning toward only at the stop for now: a warning nobody can act on mid-run is noise, and CI logs are read after the fact.
