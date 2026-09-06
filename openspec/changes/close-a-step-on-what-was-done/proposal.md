# Proposal: close-a-step-on-what-was-done

## Why

The executor closes a step whenever the model answers `done`. It never asks whether anything was done (#76).

So a step the agent could not carry out passes — and says so while passing:

```
step 2/2: enter a value in the promo code field
    -> done :: The current page does not contain a promo code field,
               so this step cannot be completed.

PASS    P0    Score: 100
```

This is not a suite someone notices failing. It is an **inflated score**, silently, on the one number `--min-score` gates merges with. A tool that exists to stop a broken change reaching production is here telling a user their broken change is fine.

The same escape closes #72's deferred half from the verification side: a step that asserts nothing closes on `done` and weighs its full priority into the score.

## What Changes

- A step SHALL NOT close on `done` when nothing succeeded during it. The attempt is refused, the model is told why, and it costs one attempt against the existing per-step retry budget — the shape the repeated-commit refusal already uses
- The refusal says what to do instead: **close a step by showing its outcome, not by stating it.** A step whose outcome already holds is closed with an assertion that it holds, which is evidence; `done` alone is self-report

## Capabilities

### Modified Capabilities

- `agentic-execution`: a step closes on what was done during it, not on the model's word that it is finished

## Impact

- New dependencies: **none**
- Affects: the `done` branch of `src/runner/executor.ts`, one accessor on `StepRecovery`, and their tests
- No config, no flag, no output format. A step that acted or asserted is unaffected — which, measured against the demo-app suite and two Juice Shop journeys, is every step in them

## Non-goals

- **No change to `judge()`.** That path is behind the worst defects this project has fixed, and this rule does not need it
- **No rule for a vague assertion that did run.** `verify the totals are right` asserts something and passes on an empty cart; catching that is a semantic judgment, and #72 records the decision that it stays documentation rather than becoming a check that can be satisfied by rewording
- **No new action vocabulary.** `fail` already exists and the model may still choose it
- **No change to scoring.** The weights are right; what was wrong is which steps reached them
