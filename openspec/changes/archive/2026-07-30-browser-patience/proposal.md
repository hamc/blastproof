## Why

`browser.timeout_ms` does not govern the thing users reach for it to govern.

`resolveTarget` waits for each candidate element with `timeout: resolveTimeoutMs`, defaulted to `2_000` at `src/runner/actions.ts:77`. No caller anywhere in `src/` passes that field, so it is always two seconds. An explicit timeout also overrides `page.setDefaultTimeout(config.browser.timeout_ms)`, so the configured value reaches the `click`/`fill`/`press` that follows a successful resolution — and never the resolution itself. `navigate` separately hardcodes `30_000` at `actions.ts:137`.

The consequence lands on exactly the applications this tool wants: an app whose button hydrates in three seconds burns the self-healing retry budget on a slow paint rather than a defect, and the obvious remedy — raising `timeout_ms` — changes nothing. Four adversarial reviews missed this because the field is read, passed to Playwright, and visibly present in the scaffolded config; it is simply routed past the one place that matters.

The snapshot cap has the same shape: `MAX_SNAPSHOT_LINES` in `src/runner/snapshot.ts` truncates what the model sees, is now documented as a limit users hit, and cannot be changed.

## What Changes

- `browser.timeout_ms` governs element resolution, not only the action performed afterwards.
- Navigation uses the configured timeout instead of a hardcoded thirty seconds.
- The accessibility snapshot cap becomes configurable, with today's value as the default.
- Existing configs behave the same unless they already set `timeout_ms`, in which case they start behaving as documented.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agentic-execution`: the configured browser timeout applies to resolving an element and to navigation; the snapshot cap is configurable rather than fixed.

## Non-goals

- **Not** an escape hatch to CSS or XPath selectors. Resolution stays semantic; this change is about how long it waits, never about what it is allowed to match.
- Not iframe, hover, scroll, upload, tab or dialog support. Those are real gaps, now documented in the README, and each is a capability of its own.
- Not a per-action or per-step timeout. One knob that means what it says beats three that need explaining.
- Not retry-budget changes. A slow page should be waited for, not retried at, and separating those is the point.

## Impact

- `src/runner/actions.ts` — `resolveTarget`'s timeout must come from the caller; `navigate`'s hardcoded value.
- `src/runner/executor.ts` — threads the configured value into the action context, which is why it was never passed.
- `src/runner/snapshot.ts` — the cap becomes a parameter.
- `src/config.ts` — an optional cap alongside `timeout_ms`.
- `src/commands/{run,plan}.ts` — supply both values.
- `src/commands/init.ts` — the scaffolded comment should say what the knob actually does.
- No new npm dependency.
