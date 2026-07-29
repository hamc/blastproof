## Context

`ActionContext` carries an optional `resolveTimeoutMs` (`src/runner/actions.ts:36`) that no caller sets. `executeTest` builds the context from `{ baseUrl, allowedOrigins, resolveValue }` (`executor.ts:211`) and omits it, so `resolveTarget` always falls back to its `2_000` default at `actions.ts:77`.

`page.setDefaultTimeout(config.browser.timeout_ms)` is called in both commands, but Playwright lets an explicit per-call timeout win, so the configured value governs `locator.click()` and friends — which have no explicit timeout — and never `locator.waitFor({ timeout: resolveTimeoutMs })`. `navigate` hardcodes `30_000` for the same reason.

The field is therefore not dead code in the usual sense. It is read, typed, threaded into Playwright, and printed in the scaffolded config with an inviting comment. It simply does not reach the decision it appears to control. That is why four adversarial reviews walked past it.

## Goals / Non-Goals

**Goals:**
- One configured timeout that governs waiting for an element, and navigating, as the documentation implies.
- A snapshot cap that can be raised when an application needs it.
- No change for anyone who has not set these values.

**Non-Goals:**
- Selector escape hatches. Resolution stays semantic.
- The unsupported interaction list (iframes, hover, upload, tabs, dialogs) — documented, each its own capability.
- Per-action or per-step timeout granularity.
- Touching the retry budget.

## Decisions

**D1 — One knob, applied at every wait, rather than a second knob for resolution.**

The tempting alternative is a separate `resolve_timeout_ms`, which preserves the current fast-fail behaviour and adds patience only where asked. Rejected: two timeouts require the user to understand the difference between finding an element and acting on it, which is an implementation detail of this codebase, not a fact about their application. A user whose app is slow wants it waited for. Fixing what `timeout_ms` means costs nothing that a second knob would have bought.

**D2 — Pass it explicitly rather than relying on `setDefaultTimeout`.**

`setDefaultTimeout` looks like it should solve this by removing the explicit argument, and it would — until someone adds a call with its own timeout and silently escapes again. Passing the configured value down the context makes the dependency visible at the call site and reviewable in a diff, and it is the same shape as the mask and the budget: the guarantee travels with the context rather than depending on ambient state set elsewhere.

**D3 — Waiting is not retrying, and raising one must not inflate the other.**

Today a slow element consumes a retry, so patience and self-healing are conflated: a three-second hydration costs a third of the budget meant for a genuinely changed UI. After this change the timeout absorbs slowness and the retry budget covers actual re-resolution. Raising the timeout must not increase attempts — this is pinned as a scenario because it would otherwise be an easy accidental regression, and because it changes what the retry budget means.

**D4 — Default behaviour is unchanged only where the value was unset.**

An existing config that already sets `timeout_ms: 30000` will start waiting up to thirty seconds where it previously waited two. That is the documented behaviour arriving for the first time, and it can make a genuinely-missing element take longer to fail. It is the right trade — a false failure is worse than a slow one — but it is a real behavioural change for existing users and belongs in the changelog in those words, not as a bugfix footnote.

## Risks / Trade-offs

- **A missing element now takes the full timeout to fail, so failing runs get slower** → mitigation: the run budget and deadline from `run-budget-and-deadline` already bound the total, so slowness cannot become unbounded. Worth stating in the changelog.
- **Someone sets a very large timeout and a hung page stalls the run** → the wall-clock deadline covers this; without one configured, the run can stall as it could before.
- **Raising the snapshot cap increases tokens per call, quietly costing more** → the budget now counts tokens, so the effect is visible and boundable rather than silent.
- **The fix looks trivial and is easy to review carelessly** → the regression test must prove resolution honours the configured value, not merely that a field is populated. A test asserting the context contains the number would pass against today's broken code.

## Migration Plan

Additive to config, corrective in behaviour. No API or data change. Rollback is reverting.

Verification needs a test that actually fails against the current code: resolve an element that becomes visible later than the old fixed two seconds but sooner than a configured longer timeout, and assert it succeeds without consuming a retry.

## Open Questions

- Should `timeout_ms` gain a documented ceiling? Leaning no: the deadline is the right place to bound total time, and a cap here would be a second thing to explain.
