# Proposal: count-a-malformed-judgment-as-an-attempt

## Why

A single malformed answer from the judge fails the test. The spec says otherwise. `llm-providers` *Structured output* requires that *"All LLM decisions (next action, assert judgment) … malformed responses SHALL count as a failed attempt within the retry budget"*. #125 restated that requirement, and the adversarial QA before 0.23.0 found that the judge never met it.

Reproduced on `examples/demo-app`, with a proxy that relays to OpenRouter and corrupts only the first judge call:

- a body that is not JSON: `X step failed: Invalid JSON response`, and the test FAILs;
- a valid completion that is not the schema: `X step failed: No object generated: could not parse the response.`, and the test FAILs;
- the same during the login journey: `error: Authentication failed at step "navigate to /login"`, exit 2.

The same corruption on an executor *decision* call is absorbed as one attempt, and the test passes. The difference is where the calls sit. `nextAction` is inside the `try` that counts attempts. Both `brain.judge` calls in `executor.ts` sit outside it, so their error reaches the step's outer handler and fails the step. `auth.ts` calls `judge` for `auth.verify` with no handling at all.

## What Changes

- In the executor, an error from either judgment that is not a stop of the run SHALL count as one failed attempt. That covers the first judgment and the re-observation, the same unit a failed judgment costs. The error is recorded as the `assert`'s result, and the step goes on with the model in the loop. The step fails only when the retry budget is spent, as a run of failed judgments does today.
- The login's `auth.verify` judgment SHALL be retried on a malformed answer, up to `max_retries_per_step`, before it reports that authentication could not be verified.
- A stop of the run (#125's `RunStoppedError`) still propagates from both places, unchanged.
- #125's stop message is missing the separator before its remedy (`…127.0.0.1:5995 The provider could not…`). It SHALL end the provider's detail with a period.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `llm-providers`: scenarios for a malformed judgment, in a step and at login. The requirement's text already covers it

## Impact

- New dependencies: **none**
- Affects `src/runner/executor.ts` (the `assert` branch), `src/auth.ts` (the `verify` judgment), `src/runner/budget.ts` (the message), and their tests
- Behaviour: a step whose judge once answered badly now takes another attempt instead of failing. A run that only failed this way now passes or fails on the page

## Non-goals

- **A log line for a malformed `nextAction` answer.** That path already counts correctly. Making the retry visible is a separate improvement
- **#132, #133 and #134**, found by the same QA pass
