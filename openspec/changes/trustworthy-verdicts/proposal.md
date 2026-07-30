## Why

The first time blastproof ran against an application that is not ours, it reported a step as failed that had succeeded. An external evaluation against Gitea filed the issue, verified the issue existed via Gitea's API, and found blastproof's own failure screenshot showing the created issue in plain view. Reproduced on two independent runs (#25).

Two defects produced it, and a third made every authenticated test more expensive along the way (#26).

**The snapshot can be taken before the page settles.** `executor.ts:173` snapshots at the top of each iteration, immediately after the previous action, with nothing waiting for a navigation in flight. A click that triggers a server round-trip and a redirect leaves the next snapshot showing the pre-redirect page, so the judge evaluates stale evidence and correctly concludes, about the wrong page, that nothing happened.

**A failed judgment re-decides instead of re-observing.** The executor's own comment says a failed judgment "may just mean the page hasn't settled: retry within budget" — but the retry returns to `nextAction`, where the model may take any action. In both observed runs it invented a navigation rather than looking again, once fabricating an `{{env.*}}` variable that appears nowhere in the test or config.

**The mask reads as a verification failure.** Every referenced secret becomes `***` in anything crossing into a prompt, and nothing tells the model what that means. So it fills a credential field, sees `***`, concludes the field is unverifiable, and refills — two to three attempts per credential field on every authenticated test. In one run with `--max-llm-calls 8`, this consumed nearly the whole budget on the first field.

Our own dogfooding could not have found any of this. The demo app redirects after login, but via `window.location.href` — a client-side navigation that settles in microseconds. Gitea does POST → 302 → GET. We had the shape and not the timing, which is why measuring #15's flake rate at 0% across twenty runs was honest and unrepresentative at the same time.

## What Changes

- The page is given a chance to settle before a snapshot is taken, so a judgment is made about the page the action produced.
- A failed judgment re-observes the same expectation before control returns to the model, so a timing artefact cannot become an invented action.
- The model is told what a redaction is, so `***` stops reading as a verification failure.
- The demo app gains a flow with a genuine server round-trip before redirecting, so this class of defect becomes reproducible in our own dogfooding instead of requiring someone else's application.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agentic-execution`: a snapshot is taken of a settled page; a failed assertion re-observes before the model re-decides; the model is told that a redacted value is expected rather than a failure.

## Non-goals

- **Not** a change to the masking boundary. `agent-containment` stays exactly as it is: every referenced secret is still redacted from every prompt input. What changes is the model being told what a redaction *is*, which is context, not protection.
- Not asking the model to enforce anything. Settling is enforced by the executor; the prompt only stops a correct redaction from being misread.
- Not the unsupported interactions (iframes, hover, upload) — those are #21 and #22.
- Not import-graph impact (#1) or usage reporting (#27).

## Impact

- `src/runner/executor.ts` — where the snapshot is taken, and the failed-judgment path.
- `src/runner/actions.ts` — `PageLike` has no way to wait for a page to settle; it needs one.
- `src/llm/prompts.ts` — `assertSystemPrompt()` is currently one sentence and says nothing about redaction; the agent prompt needs the same context.
- `examples/demo-app/serve.mjs` and its pages — a flow with real server latency before redirecting.
- `.blastproof/tests/` — a test covering that flow, so the dogfood exercises it.
- No new npm dependency: Playwright already exposes load-state waiting.
