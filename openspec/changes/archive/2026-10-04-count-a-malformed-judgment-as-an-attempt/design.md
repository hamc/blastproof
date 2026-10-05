# Design: count-a-malformed-judgment-as-an-attempt

## Context

**The spec already requires it.** `llm-providers` *Structured output*: *"All LLM decisions (next action, assert judgment) … malformed responses SHALL count as a failed attempt within the retry budget."* #125 rewrote that requirement to define "malformed" and left this sentence as it was.

**Where the calls sit.** In `executeTest`, `brain.nextAction` is inside a `try` whose `catch` counts a failed attempt and continues. The `assert` branch calls `brain.judge` twice, once for the first judgment and once for the re-observation. Neither call is inside any inner `try`. A throw reaches the step's outer `catch`, which records the step as failed. `auth.ts` calls `brain.judge(auth.verify, …)` after the login journey with no `catch`, so the error leaves `authenticate`.

**Reproduced** on `examples/demo-app`, with `anthropic/claude-haiku-4.5` through a relaying proxy that corrupts only the first judge call:

| corruption | where | result |
| --- | --- | --- |
| HTTP 200, body not JSON (`Invalid JSON response`) | `--tag consent` | `X step failed`, FAIL |
| HTTP 200, a completion that is not the schema (`No object generated`) | `--tag consent` | `X step failed`, FAIL |
| HTTP 200, body not JSON | the login journey | `Authentication failed at step "navigate to /login"`, exit 2 |

The QA pass found the same on Juice Shop, 2/2 and 1/1. The same corruption on a decision call was absorbed as a retry, and the run passed.

## Goals / Non-Goals

**Goals:** a malformed judgment costs one attempt wherever a judgment is made; a stop of the run still stops it; nothing else about a judgment changes.

**Non-Goals:** logging the `nextAction` retry, #132, #133, #134.

## Decisions

### D1: In the executor, the judgment's error is an outcome of the `assert`
The two `judge` calls are wrapped together. An error that is not a `RunStoppedError` becomes the `assert`'s result, `error: <message>`, emitted like any other result. It costs **one** attempt. When the budget is spent, the step fails with that result, through the same `StepFailure` path a failed judgment takes. Otherwise the loop continues and the model sees the error as `lastResult`.

It is one unit per `assert`, even if both calls were involved, for the reason a failed first judgment plus a failed re-observation is one unit today (design trustworthy-verdicts, D3). The re-observation is part of making one judgment, not a second attempt.

The rejected alternative was retrying the judgment silently inside `judge()`. That would add calls the budget sees but the record does not, and it would put a retry policy in the brain that the executor already owns.

### D2: At login, `verify` retries up to the configured budget
`authenticate` repeats the `verify` judgment on a malformed answer, up to `maxRetries` (default 3, as in the executor), taking a fresh snapshot each time. A `RunStoppedError` propagates at once. When every attempt is malformed, it throws `AuthError` with the last error, `Authentication could not be verified: <error>`, so the run exits 2 as for any unverifiable login. Before, the raw error escaped `authenticate`, and `runCommand` rethrew it as neither an `AuthError` nor a stop.

### D3: The stop message gets its period
`ProviderRefusedError` joins the provider's detail and the remedy with a space. When the detail does not end in `.`, `!` or `?`, a period is added first. The output was `…connect ECONNREFUSED 127.0.0.1:5995 The provider could not be reached…`.

## Risks / Trade-offs

- **[A model that always answers the judge badly now spends three attempts before failing.]** That is what the spec asks of every decision, and the decision call already behaves this way.
- **[The re-observation is lost when the first judgment errors.]** The error costs the attempt, and the next `assert` re-observes as usual.
