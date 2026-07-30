## Context

`executor.ts:173` captures the snapshot at the top of each loop iteration, immediately after the previous action returned. Nothing waits for a navigation in flight. `PageLike` (`actions.ts`) offers `goto`, three locator getters, `keyboard`, `screenshot` and `url()` — no way to ask whether the page has settled.

So the sequence that produced the false FAIL is structural, not unlucky:

1. iteration *n*: snapshot shows the issue form; the model clicks **Create Issue**; Gitea answers POST with a 302
2. iteration *n+1*: the snapshot is captured while that navigation is still in flight and shows the form again; the model asserts the issue was created; the judge evaluates the stale snapshot and fails
3. the retry returns to `nextAction`, and the model — seeing a page it cannot reconcile — invents a navigation, once with a fabricated `{{env.REPO_OWNER}}`

The judge's whole system prompt is one sentence ending "Be strict", and says nothing about redaction. That is the second defect: the model sees `***` in a field it just filled and reads it as unverifiable rather than withheld.

Our demo app cannot produce step 1. It redirects after login via `window.location.href` — client-side, settled in microseconds. Gitea does a real round-trip. We had the shape without the timing, which is why #15's 0%-over-twenty-runs was both honest and unrepresentative.

## Goals / Non-Goals

**Goals:**
- A verdict describes the page the previous action produced.
- A timing artefact cannot become an invented action.
- A correct redaction is not read as a failure.
- This class of defect becomes reproducible in our own dogfooding.

**Non-Goals:**
- Changing the masking boundary. It is correct and stays.
- Asking the model to enforce anything.
- Iframes, hover, upload (#21, #22); import-graph impact (#1); usage reporting (#27).

## Decisions

**D1 — Wait for network idle before snapshotting, bounded by a short settle budget of its own — not by `browser.timeout_ms`.**

This decision was rewritten after measuring, because the first version of it was wrong. Against the reproduction built in task group 1:

```
domcontentloaded  click=30ms  wait=   0ms  url=support.html       h1="Contact support"
load              click=26ms  wait=   1ms  url=support.html       h1="Contact support"
networkidle       click=33ms  wait=1119ms  url=support-sent.html  h1="Support ticket received"
```

The click resolves in ~30ms. The page that is still displayed has *already* finished loading, so `domcontentloaded` and `load` return in about a millisecond and leave the caller looking at the page being replaced — they do not narrow the window at all. Only `networkidle` observes the pending `fetch` and parks until the destination exists.

So the design's original instruction, "start with the weakest load state that fixes the observed case", has a measured answer: the weakest that works is the strongest available, which is also the one most likely to misbehave. An application holding a websocket, a poll or an SSE stream may never reach network idle.

That rules out the original bound. `browser.timeout_ms` defaults to 30s, so a persistent connection would burn it on *every* snapshot — a 25-step run would spend twelve minutes waiting to learn nothing. Settling therefore gets its own short budget, on the order of a second or two: long enough to cover a real round-trip, short enough that an app which never idles costs little. Exceeding it is normal and silent, not an error — the snapshot is simply taken as it is today.

The asymmetry that makes this safe: waiting too little reintroduces the defect only for slower round-trips, while waiting too long taxes every step of every run. A short bound fails toward today's behaviour rather than toward a hang.

Rejected: waiting only after actions believed to navigate. It requires predicting which actions navigate, which the accessibility tree cannot support — a click on a link, a submit button and a JS handler are indistinguishable in it. Guessing wrong reintroduces the defect on the case guessed wrong.

Also rejected: a fixed sleep. Either too short for a slow server or wasted on every fast action.

Left for implementation to settle, with the measurement above as the starting point: whether one `networkidle` wait suffices, or whether the fetch-then-navigate shape needs the wait applied again after the navigation it triggers.


**D2 — `PageLike` gains the method as required, not optional.**

Today's precedent cuts one way and the shape of this interface cuts the other, so it is worth stating. `PageLike` is *implemented* by test doubles rather than *passed* as options, so making the method required means every fake must provide it — churn, and fakes that no-op it look like they wait when they do not.

Required anyway. A page double that cannot say when it settled cannot support a trustworthy judgment, and an optional method is the shape that let `timeoutMs` and `budget` be silently omitted twice before. A no-op in a fake is at least visible in that fake; an absent method is invisible everywhere.

**D3 — A failed judgment re-observes the same expectation before the model re-decides.**

The executor's comment already states the intent — "may just mean the page hasn't settled" — and the implementation is broader than the intent, which is this codebase's recurring defect. Re-snapshot, re-judge the same expectation, and only hand back to `nextAction` when it has failed against a settled page.

Cost is one judge call on a failed assertion, which is the case we currently spend an entire model turn on and get an invented action for. Rejected: pass the failure back to the model with instructions to re-check. That is asking the prompt to do what the loop should, and the observed behaviour is precisely the model not doing it.

**D4 — Tell the model what a redaction is; do not change what is redacted.**

The boundary stays. What is added is that a redaction stands for a withheld secret, that seeing one is expected, and that a field showing one after an `{{env.*}}` fill is consistent with success.

The trade-off worth naming: this makes the redaction legible to the model, and a hostile page could already observe the mask in its own rendered text, so little is conceded. Against that, the current silence costs two to three model calls per credential field on every authenticated test and is a live false-FAIL source. Leaving a security-motivated mechanism to be misread is not a security benefit.

Considered and left open: making the mask self-describing (`***redacted***`) so it explains itself wherever it lands, with no prompt change. Attractive, but it changes a token that appears in reports and in tests, and it should not become long enough to be worth echoing. Worth doing only if the prompt route proves insufficient.

**D5 — Make the demo app able to produce the defect.**

Add a flow that answers a form POST with real server latency and then redirects, plus a test covering it. Without this, the next regression in this class waits for another outsider. This is the part of the change that makes the other parts stay fixed.

## Risks / Trade-offs

- **Waiting on every snapshot makes every step slower** → mitigation: settling resolves immediately when nothing is in flight, so the cost lands on actions that navigate, which is where it is needed. Measure it in the dogfood; if wall-clock regresses materially, revisit.
- **A page that never settles now consumes the full timeout per snapshot** → bounded by `browser.timeout_ms` and, above that, by the run deadline. A single-page app with a permanent open connection may never reach network idle; prefer the weakest load state that fixes the defect over the strictest available.
- **Re-judging spends a judge call on every failed assertion** → the case it replaces spends a full `nextAction` turn and produced a fabricated action twice out of twice. Cheaper and better.
- **Telling the model about redaction could be over-applied** → a model told redactions are expected might excuse a genuinely empty field. The scenario pinning "a redaction is not grounds for failing" must not become "anything unverifiable passes".

## Migration Plan

Behavioural, no config or API change. Existing suites should see the same verdicts, reached more reliably, plus whatever latency settling adds.

Closing criterion, and it is not a unit test: re-run against a real application with a genuine POST-redirect-GET — the same Gitea flow that produced the false FAIL — and confirm the step passes. Our own dogfood cannot substitute, since it demonstrably lacks the timing; that is what D5 fixes, and the new demo flow should be shown to fail before this change and pass after.

## Open Questions

- **Answered by measurement, recorded in D1**: only `networkidle` closes the window; `domcontentloaded` and `load` return in about a millisecond on the page being replaced. The consequence — that settling needs a short budget of its own rather than `browser.timeout_ms` — is now part of D1.
- Does an application that never reaches network idle lose the fix entirely, or only partly? The short budget bounds the cost, but a websocket-holding app gets no protection from this class of defect at all. Worth knowing before promising the fix broadly; a follow-up may need a different signal for that case, such as comparing consecutive snapshots for stability.
