## 1. Resolution honours the configured timeout

- [ ] 1.1 In `src/runner/executor.ts`, thread the configured browser timeout into the `ActionContext` built for `performAction` — the omission at the context construction site is the whole defect.
- [ ] 1.2 In `src/runner/actions.ts`, make `resolveTarget` take the timeout from the context rather than falling back to the `2_000` default, and use the configured value for `navigate` instead of the hardcoded `30_000`.
- [ ] 1.3 Comment the context field with why it must stay populated: an explicit per-call timeout overrides `setDefaultTimeout`, so an unset field silently reinstates a two-second wait.

## 2. Regression tests that fail against today's code

- [ ] 2.1 Test that an element becoming visible after the old fixed 2s, but within a longer configured timeout, resolves successfully. This must fail before the fix; verify that it does.
- [ ] 2.2 Test that such a resolution consumes no retry — design D3, so patience and self-healing stay separate.
- [ ] 2.3 Test that an element that never appears still fails and still consumes exactly one retry, so raising the timeout does not change the number of attempts.
- [ ] 2.4 Test that `navigate` uses the configured timeout rather than a fixed value.

## 3. The snapshot cap

- [ ] 3.1 Make the cap in `src/runner/snapshot.ts` a parameter, keeping the current value as the default.
- [ ] 3.2 Add the optional setting to `src/config.ts` and supply it from `run` and `plan`.
- [ ] 3.3 Tests: default preserved when unset; a raised cap admits more lines; truncation stays visibly marked at whatever cap applies.

## 4. Verification

- [ ] 4.1 `npm run build`, typecheck and the full vitest suite green.
- [ ] 4.2 Confirm the new tests fail against the pre-fix behaviour, in a throwaway copy. A test that passes both before and after protects nothing — this check has caught real problems twice on this project.
- [ ] 4.3 Dogfood: an ordinary run against the demo app still passes with score 100, since the demo app is fast and nothing here should change its outcome.

## 5. Documentation

- [ ] 5.1 `src/commands/init.ts`: the scaffolded comment should say the timeout covers finding an element as well as acting on it.
- [ ] 5.2 README: state what `timeout_ms` governs, and that raising it makes a genuinely missing element take longer to fail; mention the new snapshot cap setting where the 200-line limit is documented.
- [ ] 5.3 CHANGELOG under Unreleased — as a behavioural change for anyone who already set `timeout_ms`, in those words, not as a quiet bugfix.
