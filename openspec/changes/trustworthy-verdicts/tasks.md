## 1. The demo app can produce the defect

- [x] 1.1 Add a flow to `examples/demo-app/serve.mjs` that answers a form POST with a genuine server-side delay and then redirects — the pattern our current app lacks. `window.location.href` after a synchronous check settles in microseconds and is why twenty clean dogfood runs proved less than they appeared to.
- [x] 1.2 Add the page(s) the flow needs, with the same accessible markup as the rest of the demo app.
- [x] 1.3 Add a test under `.blastproof/tests/` covering it, with `routes:` set so `--impacted` selects it.
- [x] 1.4 **Do this group first, and confirm the new test FAILS against the current executor.** If it passes, the reproduction is not faithful and the rest of this change cannot be verified. Report the failure before continuing.

## 2. Snapshots describe a settled page

- [x] 2.1 Add a way to wait for a settled load state to `PageLike` in `src/runner/actions.ts`, as a **required** member (design D2), and implement it in the test doubles.
- [x] 2.2 In `src/runner/executor.ts`, wait for network idle before capturing the snapshot at line ~173, bounded by a **short settle budget of its own** — NOT by `browser.timeout_ms`. Exceeding it is normal and silent: take the snapshot as it is today. See design D1 for why the obvious bound is wrong.
- [x] 2.3 ~~Use the weakest load state that fixes the reproduction~~ — settled by measurement before implementation: only `networkidle` works (`domcontentloaded` and `load` return in ~1ms on the page being replaced). Use it, with a short settle budget of its own rather than `browser.timeout_ms`. See design D1.
- [x] 2.4 Comment why the wait is unconditional rather than applied only after actions believed to navigate: a click on a link, a submit button and a JS handler are indistinguishable in the accessibility tree, so guessing reintroduces the defect on the case guessed wrong.

## 3. A failed judgment re-observes before the model re-decides

- [x] 3.1 On a failed `assert` judgment, capture a fresh snapshot and evaluate the **same** expectation again before returning to `nextAction`.
- [x] 3.2 Only hand control back to the model once the expectation has failed against a freshly settled page.
- [x] 3.3 Keep it bounded by the existing retry budget, so re-looking cannot loop.
- [x] 3.4 Replace the existing comment — it states the intent ("may just mean the page hasn't settled") that the old code did not implement; it should now describe what the code does.

## 4. A redaction is described, not left ambiguous

- [x] 4.1 In `src/llm/prompts.ts`, tell both the agent and the judge what a redaction is: it stands for a deliberately withheld secret, seeing one is expected, and a field showing one after an `{{env.*}}` fill is consistent with the fill having succeeded.
- [x] 4.2 State that a redaction is not grounds for failing an expectation — without licensing "anything unverifiable passes" (design risk).
- [x] 4.3 Do **not** change what the mask redacts. `agent-containment` is unchanged; add a comment saying so, since a future reader may otherwise read this as loosening the boundary.

## 5. Tests

- [x] 5.1 A snapshot is captured only after the page settles; assert on the ordering, not merely that a wait method exists.
- [x] 5.2 Settling stops at the configured timeout when a page never settles, and the loop proceeds.
- [x] 5.3 An expectation that fails on a stale snapshot and holds on a settled one passes, without `nextAction` being called again — this is the false FAIL, in unit form.
- [x] 5.4 An expectation that fails on a settled page still reaches the model, unchanged.
- [x] 5.5 Re-observation is bounded by the retry budget.
- [x] 5.6 The mask still redacts every registered secret from every prompt input — the boundary, pinned so this change cannot quietly weaken it.
- [x] 5.7 Every test above must fail against the current code. Verify it, and say which ones did.

## 6. Verification

- [x] 6.1 `npm run build`, typecheck and the full vitest suite green.
- [x] 6.2
  - The support flow now passes (`1 passed, Score: 100`); it failed deterministically 4/4 before. The group 1 demo flow now passes, and previously failed.
- [x] 6.3
  - Full suite locally: `6 passed, 0 failed, Score: 100` in 155s. Wall-clock is not comparable to the earlier CI figures (different machine); the login test fell from 27.1s to 21.2s, consistent with the redaction fix removing refills and offsetting the settle waits. A like-for-like measurement needs the CI dogfood. Dogfood: the whole suite still scores 100, and report whether wall-clock regressed materially now that every snapshot waits.
- [x] 6.4
  - Verified against a live Gitea 1.27.1: `PASS ... Score: 100`, with the assertion immediately after the click reading `The snapshot contains a level 1 heading that reads 'Settle fix verification #4'` — the destination page, not the form.
  - Recorded honestly: the first attempt failed because the test step named an action without stating its outcome, so the model invented a poor expectation. That was my error, not the product's; reading the full log rather than the tail is what caught it. It did expose a genuine product concern, filed separately: the model took *destructive* recovery actions, creating duplicate issues. Re-run against the real application that produced the false FAIL — a genuine POST-redirect-GET — and confirm the step passes. Our own dogfood does not substitute; that is what group 1 exists to change.

## 7. Documentation

- [x] 7.1 CHANGELOG under Unreleased: the false FAIL, what caused it, and that it was found by an outside evaluation rather than by us.
- [x] 7.2 Note in `AGENTS.md` that a verdict must describe the page the action produced, alongside the existing conventions.
- [x] 7.3 Comment on #25 and #26 with the outcome and the measurement, and close them only once 6.4 holds.
