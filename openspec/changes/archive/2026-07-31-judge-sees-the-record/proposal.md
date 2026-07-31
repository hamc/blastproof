## Why

A step that names a path is failed when the server redirects, because the judge compares the URL it can see against the path the step named and has no way to know a redirect happened (#35).

Measured against 0.9.0, same step, same destination content, same model, one variable changed:

| the step | `/away` redirects to | outcome |
|---|---|---|
| `navigate to /away` | `/destination`, same host | **3 of 3 pass** |
| `navigate to /away` | `http://localhost:4194/`, another host | **3 of 3 fail** |

So the trigger is not the redirect — it is the **host changing**. The issue as filed says a redirecting path fails; that is too broad, and the sharper statement matters, because a same-origin redirect passing is luck rather than correctness. The judge's reason names it plainly: *"The current URL is http://localhost:4194/ instead of the expected http://localhost:4195/away, indicating the navigation did not occur."* The navigation did occur. It was reported as `ok`. The agent then retried it twice more and was failed twice more.

This is the third defect in one family. **The action erases its own evidence**: a successful navigation to a redirecting path cannot leave the browser at that path, exactly as a successful submit cannot leave the form filled (#28) and a successful action removes the control the step names (the clause added in 0.6.0). Each time, the judge was asked whether something happened while looking at the state that succeeding produces.

DEF-005 recorded what to do when a third one appeared: **the judge never receives the record of what was done, and that is the structural lever to try before a fourth prompt clause.** This is that third one.

## What Changes

- A `navigate` action reports **where it landed** when that differs from where it was asked to go, instead of reporting only the request.
- The judge receives the **record of actions already performed in the step**, which the executor already builds, already masks and already scopes per step. It can then see that a navigation was performed and where it ended up, rather than inferring from a URL alone.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agentic-execution`: a judgment is made with the step's own record of what was done in view, and a navigation reports its landing URL.

## Non-goals

- **Not a fourth prompt clause telling the judge that redirects are normal.** DEF-005 exists because this project reaches for that too readily, and a clause would cover redirects while leaving the family open.
- Not relaxing `judge-the-step`. The record says what was *done*; it must not become evidence that the step's *outcome* holds. That distinction is the main risk here and is stated in the design.
- Not changing containment. A redirect that leaves the allowed origins still fails first, before any of this applies.
- Not the impact report's vocabulary (#39).

## Impact

- `src/runner/actions.ts` — `navigate` compares the landing URL with the requested one.
- `src/llm/brain.ts`, `src/llm/prompts.ts` — `judge()` takes the step's record; the judge prompt frames it as history, not as evidence.
- `src/runner/executor.ts` — passes the record it already holds to both judge calls.
- `src/auth.ts` — the login journey judges through the same path; must be verified against a real model, because a transcript in a prompt broke it once before.
- No new npm dependency.
