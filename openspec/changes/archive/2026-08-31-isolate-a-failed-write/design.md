# Design: isolate-a-failed-write

## Context

The per-route loop in `planCommand` handles two failures. Generation is contained: any error that is not a budget stop is recorded against the route and the loop continues (D9). Persistence is contained only for `PlannerError`; anything else is rethrown and ends the run.

`writeDraft` today wraps every filesystem fault in a `PlannerError` — @abhijeetnardele24-hash's fix for the missing directory (#77) put the `mkdir` and the `writeFile` inside one `try`. So the escape is currently unreachable, and the defect #75 describes is not reproducible on `main`.

That is exactly the state worth writing down rather than closing quietly. The containment lives in the callee's discipline, not in the loop, and nothing says so — the next person to add a line to the write branch, or to narrow what `writeDraft` catches, restores the defect and no test notices.

## Goals / Non-Goals

**Goals:**
- The loop is isolated by its own construction, not by what the function it calls happens to throw
- The behaviour #75 asks for is covered by a test that fails if the escape returns

**Non-Goals:** changing which routes fail, retrying a failed write, or reshaping the error message.

## Decisions

### D1: Contain by kind-independence, not by adding kinds
The write branch stops discriminating on the error type and does what the generation branch does: record the reason, print it, continue. Not `catch (PlannerError | SomeOtherError)` — the list of filesystem faults worth surviving is open-ended, and enumerating it is how this loop came to have two different answers for the same question.

The alternative — leave the code, add only the test — was rejected. The test would pass today for a reason that is not the property being asserted: it would be exercising `writeDraft`'s wrapping, and it would keep passing if the loop were made worse.

### D2: A route that fails to write is not a generated route
`generated.push(route)` happens before the write, so the branch pops it. That is existing behaviour for the collision case and it stays: `Generated:` names routes that produced a file, and a route reported under both headings would be worse than either.

### D3: The unreachable branch is worth a test
The second test mocks `writeDraft` to throw a plain `Error`, which no current code path produces. That is deliberate. It pins the contract at the boundary — the loop survives a write failure it does not recognise — instead of pinning it at whatever `writeDraft` currently guarantees. It is the only test in this change that would have failed before it.

## Rejected alternatives

- **Test only, no code change** — asserts the callee's behaviour while claiming the caller's (D1)
- **Rethrow only for programmer errors (`TypeError`, `RangeError`)** — a plausible-sounding rule that puts the drafts already paid for behind a taxonomy nobody will maintain, and every one of those errors is still reported and still exits non-zero when contained
- **Persist drafts to a temporary location before the loop ends** — a real improvement to a different problem (a budget stop discards drafts too) and much larger; it belongs to whoever takes #13's ground

## Risks / Trade-offs

- **An unexpected error now prints one line instead of a stack.** The reason is reported, the route is named, and the exit code is non-zero — but a programmer error in this branch is quieter than it was. Accepted: the loop's job is to finish the routes, and a run that stops silently mid-way is the failure this change exists to prevent.

## Migration Plan

Nothing to migrate. Behaviour changes only on a path no current code reaches.

## Open Questions

- ~~**Should a budget stop still discard the drafts it interrupted?**~~ Answered by reading the code rather than filing the issue: it discards nothing. `generateForRoute` makes exactly one model call per route, and `countedGenerate` checks the budget *before* spending, so exhaustion is raised at the start of a route rather than between two calls of one. Every earlier route has already been written (or printed), and the interrupted route cost a page load and a snapshot — no model spend. The loop reports it under `Not attempted`, which is correct. There is no second door here; the claim was asserted in this change's PR before it was checked.
