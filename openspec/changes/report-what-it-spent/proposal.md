## Why

A run counts every model call and every token — that is how `budget:` enforces its limits — and then discards the totals. They exist in `RunBudget` when the run ends and nobody is told (#27).

An external evaluator sizing what a pull-request gate would cost had to ask the provider instead:

> Cost: roughly $0.11 / 126s for a realistic single `run --impacted` PR-gate invocation on Haiku via OpenRouter — tolerable. But a completed run never reports its own actual LLM-call/token consumption; I had to query OpenRouter directly.

The only cost figure the tool volunteers today is `--dry-run`'s worst-case ceiling, which is deliberately a maximum and usually many times the real number. So the one number we offer is the one furthest from the truth. Someone sizing `max_llm_calls` from it sets it far too high; someone wanting to size it from experience cannot, because the tool never reports experience.

It also makes the budget feature harder to adopt than it needs to be, and it would have made two findings in that evaluation visible immediately instead of requiring provider forensics.

## What Changes

- A finished run reports **what it actually spent**: model calls, and tokens, against the configured limits when any are set.
- An interrupted run reports it too. That is the case where the number matters most, and it is the one a stop currently leaves unanswered.
- The totals go into the JUnit properties beside `score`, so a pipeline can trend cost without scraping stdout, and into the HTML report.
- Where a provider does not report token usage, that is said rather than shown as zero.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `run-budget`: what a run spent is reported, not only enforced.
- `junit-report`: the spend is exposed as properties alongside the score.

## Non-goals

- **Not currency.** The same reasoning that keeps the budget denominated in calls and tokens applies to reporting them: a price table is wrong the day a provider reprices, and wrong for anyone behind a gateway. Calls and tokens are what we actually know.
- Not per-test or per-step attribution. The budget is a run-wide count by design, and splitting it would mean threading counters through the executor for a number nobody has asked for yet.
- Not input/output token split. `CallUsage` records the total only, and widening it is a separate question.
- Not a cost forecast. `--dry-run`'s ceiling stays exactly what it is, a maximum; this reports the past, not the future.

## Impact

- `src/runner/budget.ts` — `RunBudget` gains a readable summary, including how many calls reported usage at all.
- `src/commands/run.ts`, `src/commands/plan.ts`, `src/commands/test.ts` — the command that *owns* the budget reports it, so a composed `test` run reports once rather than once per phase.
- `src/report/junit.ts`, `src/report/html.ts` — the totals as properties and in the summary block.
- No new npm dependency.
