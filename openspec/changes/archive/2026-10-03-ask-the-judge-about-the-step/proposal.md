# Proposal: ask-the-judge-about-the-step

## Why

A test built to fail **passed in 3 of 5 runs** against a live OWASP Juice Shop (#120). Replaying the judge inputs captured from those runs, at temperature 0, isolates two deterministic paths:

- **Placeholder in the step, label on the page.** #87 labels values, so the page reads `[redacted TEST_EMAIL]`. But the step's `{{env.TEST_OTHER}}` is a placeholder, not a value, and reaches the judge as written. The executor offered *"[redacted TEST_EMAIL] which is the account email {{env.TEST_OTHER}}"* and the judge accepted it: **0 of 10** correct. #87 was verified with the value written literally in the step; the normal way to write one is the placeholder.
- **A weakened expectation.** The executor offered *"redirected away from the login page, **or** an Account menu should be accessible"*, and the judge passed on the easy half: **0 of 5** for that input. The schema asks exactly that: `pass` is *"Whether the snapshot satisfies the **expectation**"*, the question `judge-the-step` retired from the prompt.

## What Changes

- The judge SHALL read every `{{env.NAME}}` in the step, the expectation and the step's record as `[redacted NAME]`, the vocabulary the page is already in. Done inside `judge()`, so all three call sites get it.
- The judgment schema SHALL ask whether the snapshot shows the **step's** outcome, failing when any part of it is not shown or cannot be assessed, with the reason produced before the verdict.
- A step naming `[redacted X]` SHALL NOT pass when X's label is in neither the page nor the step's own actions while a different label is on the page. Live, the first two changes alone still let the judge call two different labels a match in 2 of 4 runs.
- A **judge regression corpus** SHALL be committed: judge inputs with known correct verdicts, from every incident that can be rebuilt (#31, #35, #87, #112, #120, #121), run by `npm run eval:judge` before any change to the judge merges. Each verdict fix so far was verified only against its own reproduction.

Replayed on the 19 distinct captured inputs, each change alone leaves wrong PASSes (0/6 and 3/6 on the first path). Together: 6/6 and 27/27, controls 12/12.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: the judgment is asked about the step in its own schema, and reads placeholders as labels

## Impact

- New dependencies: **none**
- Affects `src/llm/brain.ts` (`judge()`), `src/llm/schemas.ts`, `src/runner/env.ts` (a placeholder-to-label helper), their tests; adds `evals/judge/` and an `eval:judge` script, which needs a model key and so is not part of CI
- No config, flag or output format. The executor still types placeholders as now

## Non-goals

- **#121**, the false negative when a step's means is no longer needed. No variant measured here moved it, so it gets its own change
- **A structured per-outcome verdict** (#120's proposal): measured, it fixed less
- **Shape 2 of #120**: its verdicts replayed correct; the defect is the reasoning
