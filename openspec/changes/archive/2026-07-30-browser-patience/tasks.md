## 1. Resolution honours the configured timeout

- [x] 1.1 In `src/runner/executor.ts`, thread the configured browser timeout into the `ActionContext` built for `performAction` — the omission at the context construction site is the whole defect.
- [x] 1.2 In `src/runner/actions.ts`, make `resolveTarget` take the timeout from the context rather than falling back to the `2_000` default, and use the configured value for `navigate` instead of the hardcoded `30_000`.
- [x] 1.3 Comment the context field with why it must stay populated: an explicit per-call timeout overrides `setDefaultTimeout`, so an unset field silently reinstates a two-second wait.

## 2. Regression tests that fail against today's code

- [x] 2.1 Test that an element becoming visible after the old fixed 2s, but within a longer configured timeout, resolves successfully. This must fail before the fix; verify that it does.
- [x] 2.2 Test that such a resolution consumes no retry — design D3, so patience and self-healing stay separate.
- [x] 2.3 Test that an element that never appears still fails and still consumes exactly one retry, so raising the timeout does not change the number of attempts.
- [x] 2.4 Test that `navigate` uses the configured timeout rather than a fixed value.

## 3. The snapshot cap

- [x] 3.1 Make the cap in `src/runner/snapshot.ts` a parameter, keeping the current value as the default.
- [x] 3.2 Add the optional setting to `src/config.ts` and supply it from `run` and `plan`.
- [x] 3.3 Tests: default preserved when unset; a raised cap admits more lines; truncation stays visibly marked at whatever cap applies.

## 4. Verification

- [x] 4.1 `npm run build`, typecheck and the full vitest suite green.
- [x] 4.2 Confirm the new tests fail against the pre-fix behaviour, in a throwaway copy. A test that passes both before and after protects nothing — this check has caught real problems twice on this project.
  - Verified independently, not only by dev: removing `timeoutMs` from a production call site fails typecheck with `TS2741`; reverting `auth.ts`'s cap threading fails exactly the two DEF-003 tests, covering both the journey snapshot and the `verify` judge call. The shared options builder injects a stub `snapshot`, so the two tests exercising the real default snapshotter deliberately bypass it, with the reason left in a comment.
- [x] 4.3 Dogfood: an ordinary run against the demo app still passes with score 100, since the demo app is fast and nothing here should change its outcome.
  - Verified on `fix/browser-patience`, dogfood run `30507091134`: `5 passed, 0 failed`, `Score: 100 — min-score 80: pass`. The demo app is fast, so an unchanged outcome is the point — the timeout now governs resolution without altering the common path.

## 5. Documentation

- [x] 5.1 `src/commands/init.ts`: the scaffolded comment should say the timeout covers finding an element as well as acting on it.
- [x] 5.2 README: state what `timeout_ms` governs, and that raising it makes a genuinely missing element take longer to fail; mention the new snapshot cap setting where the 200-line limit is documented.
- [x] 5.3 CHANGELOG under Unreleased — as a behavioural change for anyone who already set `timeout_ms`, in those words, not as a quiet bugfix.
