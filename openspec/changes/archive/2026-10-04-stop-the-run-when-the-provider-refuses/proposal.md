# Proposal: stop-the-run-when-the-provider-refuses

## Why

When the model provider refuses a request, blastproof reports the application as broken (#125). The executor treats any model-call error as a malformed answer, spends the retry budget and fails the step.

Reproduced on `examples/demo-app` with a fake provider answering HTTP 402 in OpenRouter's words:

- **Tests without a login:** both FAIL, `Score: 0`, exit 1, like a regression.
- **The full suite, whose config has a login:** `error: Authentication failed at step "navigate to /login"`, exit 2. The login is blamed.

`run-budget` settled this for the run's *own* budget: it ends the run as **incomplete**, never as a failed test, because exhaustion says nothing about the application. Neither does a provider that will not answer.

## What Changes

- A model call that got **no response** from the provider SHALL stop the run as incomplete, by the path a budget stop already takes. "No response" is an HTTP error status (≥ 400) or no status at all (a network failure). That includes the AI SDK's `RetryError` wrapping one. The line is the error's type and status, never its message.
- A call that got a bad response stays a failed attempt within the retry budget: a schema rejection, an invalid action, or a 2xx whose body does not parse.
- The incomplete reason SHALL give the HTTP status and the provider's own words, say that the remaining tests were not run, and give a remedy for the status class: the key for 401/403, credit for 402, running again later for 429, 5xx or no response.
- A refusal during the login journey SHALL stop the run as incomplete, not report `Authentication failed` with exit 2. A refusal during `plan` SHALL stop it the way a budget stop does.

No retry of our own: the AI SDK already retries 408, 409, 429, 5xx and network failures twice with backoff, honouring `retry-after`, before an error reaches blastproof.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `llm-providers`: a call the provider refused is not a malformed response
- `run-budget`: a provider refusal is a second cause of an incomplete run

## Impact

- New dependencies: **none** (`ai` exports `APICallError` and `RetryError`)
- Affects `src/llm/brain.ts` (the choke point every model call passes through), `src/runner/budget.ts` (a shared base for "the run stopped"), the catch sites testing for a budget stop (`executor.ts`, `auth.ts`, `commands/run.ts`, `commands/plan.ts`), and their tests
- Behaviour: such a run now ends **incomplete**, exit 1 whatever `--min-score` is, instead of failed tests or exit 2 at login. Reports already show an incomplete run

## Non-goals

- **A separate exit code** for a 401 or 402. Exit 2 means nothing ran because of the invocation, and results of tests that finished before the refusal are real
- **Our own backoff or a configurable retry count**: the SDK's already apply
- **Counting a refused call in `Spent:`**: no usage came back
- **#126**, the 64000 output tokens reserved per call, which made this 402 arrive early
