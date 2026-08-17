# Tasks: env-placeholder-must-be-named

## 1. One definition of a placeholder
- [ ] 1.1 Delete `ENV_PLACEHOLDER` from `src/runner/recovery.ts` and use `referencedEnvVars` from `src/runner/env.ts` instead (D2). Nothing else in the codebase should carry a second rule for what a placeholder is.
- [ ] 1.2 Unit tests pinning the cases the old regex disagreed on: `{{ env.TOKEN }}` with internal spaces, and `Bearer {{env.TOKEN}}` embedding one, are now judged by the same rule as a bare placeholder.

## 2. The check
- [ ] 2.1 Keep the step verbatim on `StepRecovery` alongside the normalised copy (D3), so variable names are compared without case folding.
- [ ] 2.2 In `unsourcedValueRefusal`, refuse when the value references any variable the step does not — ahead of the exemption it qualifies (D1, D5). A value referencing only named variables stays exempt from the text comparison.
- [ ] 2.3 The message names what the step references and offers the two legitimate exits, without reading as an invitation to try another variable (D6).
- [ ] 2.4 Unit tests: a placeholder the step names passes; one it does not is refused; `{{env.TOKEN}}` vs `{{env.token}}` is refused; a value naming two variables needs both; a fresh instance does not inherit the previous step's variables.

## 3. End to end
- [ ] 3.1 Executor test reproducing #66: step `fill the Password field` naming no value, model proposes `{{env.ACTUAL_PASSWORD}}`, refused rather than typed — and the real value never reaches the page.
- [ ] 3.2 A regression test for the leak itself (D7): a variable set in the environment but named by no step is refused, so no unmasked secret can reach a prompt. This is the property the issue was really about and it should fail loudly if the check is ever loosened.
- [ ] 3.3 Confirm an `auth.steps` login journey is unaffected — the recipe's own step names its placeholder (D4).

## 4. Docs
- [ ] 4.1 README, beside the value rule: a placeholder counts as a source only when the step names it, and why.
- [ ] 4.2 `docs/auth.md`: the same, where `{{env.*}}` is introduced as the only way to reference a credential. CHANGELOG is written at release time, not here.

## 5. Verification
- [ ] 5.1 `npm run build`, `npm run typecheck`, `npm test` green.
- [ ] 5.2 Against `examples/demo-app` with a real model: the login test, whose step names `{{env.*}}`, still passes; and a step naming no value is refused rather than filled with a guessed placeholder. Both halves, as in `refuse-an-invented-value` — the second proves the fix, the first proves it did not break authentication.
