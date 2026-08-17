# Tasks: env-placeholder-must-be-named

## 1. One definition of a placeholder
- [x] 1.1 Delete `ENV_PLACEHOLDER` from `src/runner/recovery.ts` and use `referencedEnvVars` from `src/runner/env.ts` instead (D2). Nothing else in the codebase should carry a second rule for what a placeholder is.
- [x] 1.2 Unit tests pinning the cases the old regex disagreed on: `{{ env.TOKEN }}` with internal spaces, and `Bearer {{env.TOKEN}}` embedding one, are now judged by the same rule as a bare placeholder.

## 2. The check
- [x] 2.1 Keep the step verbatim on `StepRecovery` alongside the normalised copy (D3), so variable names are compared without case folding.
- [x] 2.2 In `unsourcedValueRefusal`, refuse when the value references any variable the step does not — ahead of the exemption it qualifies (D1, D5). A value referencing only named variables stays exempt from the text comparison.
- [x] 2.3 The message names what the step references and offers the two legitimate exits, without reading as an invitation to try another variable (D6).
- [x] 2.4 Unit tests: a placeholder the step names passes; one it does not is refused; `{{env.TOKEN}}` vs `{{env.token}}` is refused; a value naming two variables needs both; a fresh instance does not inherit the previous step's variables.

## 3. End to end
- [x] 3.1 Executor test reproducing #66: step `fill the Password field` naming no value, model proposes `{{env.ACTUAL_PASSWORD}}`, refused rather than typed — and the real value never reaches the page.
- [x] 3.2 A regression test for the leak itself (D7): a variable set in the environment but named by no step is refused, so no unmasked secret can reach a prompt. This is the property the issue was really about and it should fail loudly if the check is ever loosened.
- [x] 3.3 Confirm an `auth.steps` login journey is unaffected — the recipe's own step names its placeholder (D4).

## 4. Docs
- [x] 4.1 README, beside the value rule: a placeholder counts as a source only when the step names it, and why.
- [x] 4.2 `docs/auth.md`: the same, where `{{env.*}}` is introduced as the only way to reference a credential. CHANGELOG is written at release time, not here.

## 5. Verification
- [x] 5.1 `npm run build`, `npm run typecheck`, `npm test` green.
- [x] 5.2 Against `examples/demo-app` with a real model: the login test, whose step names `{{env.*}}`, still passes; and a step naming no value is refused rather than filled with a guessed placeholder. Both halves, as in `refuse-an-invented-value` — the second proves the fix, the first proves it did not break authentication.

  **Measured** (`anthropic/claude-haiku-4.5` via OpenRouter, against `examples/demo-app`).
  A login whose steps name `{{env.TEST_EMAIL}}` and `{{env.TEST_PASSWORD}}` scores **100**, with both
  placeholders passed through unresolved to the runner and substituted at the keystroke — the
  regression risk that mattered, since this change touches the path every authenticated suite uses.

  The refusal half did **not** reproduce with a live model here, and the reason is worth recording
  rather than retrying until it did. Asked to `fill the password field` with no value, the model
  typed `demo123` — and was correctly allowed, because the demo app's login page displays
  `demo@blastproof.dev / demo123` on screen as a hint. The value genuinely came from the page. That
  is the check working, not a bypass, but it means this application cannot stage the guessed-variable
  case: there is no field here whose value the page withholds.

  The refusal is therefore pinned deterministically instead, in `tests/executor.test.ts`. Both of
  those tests were confirmed to fail with the new condition disabled and pass with it enabled, so
  they are load-bearing rather than decorative. A live reproduction needs an application that hides
  its credentials — the Actual Budget run in #66 is that application, and its report is the evidence.
