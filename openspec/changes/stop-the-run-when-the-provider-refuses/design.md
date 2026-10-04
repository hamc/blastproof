# Design: stop-the-run-when-the-provider-refuses

## Context

Read and measured rather than assumed:

**Every model call passes through one function.** `countedGenerate` in `src/llm/brain.ts` checks the budget, calls `generateObject` and records usage, for the executor, the judge, the login check and the planner alike. It already rewrites a provider error's message (`withProviderDetail`), so that its body reaches the user. It is the choke point `AGENTS.md` asks a run-wide guarantee to live at.

**The error arrives typed, and already retried.** In `ai` 7.0.37:
- A response with an HTTP error status throws `APICallError`, with `statusCode`, `responseBody` and `isRetryable`. The last is true for 408, 409, 429 and ≥ 500.
- A network failure (`fetch failed`) is wrapped in an `APICallError` with no status and `isRetryable: true`.
- `generateObject` retries retryable errors twice, starting at 2 s and doubling, and honours `retry-after`. When those retries are exhausted it throws `RetryError`, whose `lastError` is the `APICallError`. A non-retryable error on the first attempt is thrown as-is.
- A 2xx whose body is not valid JSON is also an `APICallError`, with that 2xx status. A schema-invalid object is `NoObjectGeneratedError`, and an action our own schema rejects is `MalformedModelOutputError`.

**The run already has a stop that is not a failure.** `BudgetExhaustedError` is caught in `executor.ts` (twice), `auth.ts`, `commands/run.ts` (the login, each test) and `commands/plan.ts` (twice). Every one of those sites rethrows it or records the run as incomplete: the tests not run are reported as not run, the reports say the run stopped, and the exit is 1 whatever `--min-score` is. Reports read only the error's `message`. One console line assumes the cause: *"test(s) not run (run stopped by its budget or deadline)"*.

**Reproduced.** A fake OpenAI-compatible server answering 402 with OpenRouter's body, against `examples/demo-app`:
- `--tag consent --tag auth`: two FAIL, `Score: 0`, exit 1.
- The full suite: `error: Authentication failed at step "navigate to /login": retry budget exhausted (3): error: This request requires more credits…`, exit 2. `runJourney` turns every non-budget error into `AuthError`.

## Goals / Non-Goals

**Goals:** a refused call never becomes a failed test or a failed login; the stop says what the provider said and what to do; a model that answers badly still costs a retry, as today.

**Non-Goals:** a separate exit code, our own retries, counting refused calls, #126.

## Decisions

### D1: The line is "did a response arrive"
A call is the provider's failure when it ends in an `APICallError` whose `statusCode` is absent or ≥ 400, or in a `RetryError` whose `lastError` is one. Everything else stays where it is today, a failed attempt within the retry budget. That includes a 2xx whose body did not parse, because a response came back and the next attempt may well parse.

The test is on the error's type and status, never on its message. Messages are the provider's prose and differ between OpenRouter, OpenAI and Anthropic. `withProviderDetail`'s comment already records a credit limit, a rate limit and an unknown model all arriving as the same class.

Every status ≥ 400 counts, not a list of them. A 400 for a context length or an unknown model fails every later call just as surely as a 402. Spending each step's retries on it only multiplies the noise, and none of it is about the application.

### D2: One base class for "the run stopped"
```ts
export abstract class RunStoppedError extends Error {}
export class BudgetExhaustedError extends RunStoppedError { … }   // unchanged otherwise
export class ProviderRefusedError extends RunStoppedError {
  readonly statusCode: number | undefined;
}
```
Every site that tests `instanceof BudgetExhaustedError` tests `instanceof RunStoppedError` instead, and the `incomplete` and `stoppedBy` variables take the base type.

The alternative was a second `instanceof` at each of the seven sites. That is the shape this codebase keeps getting wrong: one site would be missed, the same way `plan`'s planner shipped without a budget. With one base, a site that handles budget stops handles refusals by construction. `RunStoppedError` lives in `budget.ts`, beside the class it generalises, so the import at each site only changes name.

`countedGenerate` converts the error once, after `withProviderDetail` has added the body. No call site sees an `APICallError` from then on.

### D3: The reason names the status, the provider's words and a remedy
```
model provider refused the request (HTTP 402): This request requires more credits… — provider said: {…}.
Add credit to the provider account, then run again.
```
The remedy depends only on the status:

| status | remedy |
| --- | --- |
| 401, 403 | check the API key named by `llm.api_key_env` |
| 402 | add credit to the provider account |
| 408, 409, 429, ≥ 500 | the provider was unavailable after 3 attempts; run again later |
| none | the provider could not be reached after 3 attempts; check `llm.base_url` and the network |
| other 4xx | the provider's own words, with no remedy added |

The brain does not know the key's variable name, so the remedy names the config field that holds it. This meets the prerequisite-boundary standard in `AGENTS.md`: it names the component, the field and what to do. "After 3 attempts" holds because it is the SDK's default, and nothing here overrides it. The console line that assumed a budget becomes *"test(s) not run (run stopped: <reason>)"*.

### D4: Incomplete, not exit 2
Exit 2 means the invocation could not start: a missing key, a bad config, a failed login. When a refusal comes mid-run, the tests that finished before it have real results, and incomplete is the state that keeps them and still refuses to pass the gate. A 401 on the very first call is arguably configuration. Telling "first call" from "later call" would give one cause two outcomes depending on timing, and either way the run exits non-zero.

### D5: A refusal during login is not a broken login
`runJourney` rethrows `RunStoppedError` before wrapping the rest in `AuthError`, as it already does for a budget stop, and `runCommand` records the run as incomplete. The executor rethrows the refusal from both its catch blocks, so a login step never reaches *"Authentication failed at step …"*.

## Risks / Trade-offs

- **[A transient 5xx now stops the whole run.]** Before, it cost a retry and a later attempt might succeed. But the SDK has already retried it twice with backoff by the time we see it, and the executor's retries came immediately after, against the same outage. Accepted.
- **[A 400 caused by one page stops the run.]** A snapshot too large for the model's context fails every call on that page. It still says nothing about the application, and `browser.max_snapshot_lines` is the remedy, which is in the provider's words.
- **[An OpenAI-compatible server that wraps errors in a 200.]** That would stay a failed attempt, as today. It does not happen with the providers we support. Not handled.
