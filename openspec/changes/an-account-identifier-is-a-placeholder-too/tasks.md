# Tasks: an-account-identifier-is-a-placeholder-too

## 1. The rule

- [x] 1.1 `plannerSystemPrompt()` carries the rule from design D1 in place of the password-token-key line. Verify with a test asserting the prompt names the property and the email and username examples
- [x] 1.2 `skills/blastproof/references/authoring.md` carries the same line, byte for byte. Verify that `tests/skill-manifest.test.ts` passes, and that it fails when only one of the two copies is changed

## 2. The check

- [x] 2.1 A pure function returns, for a list of steps and a snapshot, each step index and email address found in the step and absent from the snapshot, compared case-insensitively (design D2). Verify with unit tests: #100's observed step is reported; an address present in the snapshot is not; a `{{env.TEST_EMAIL}}` step is not; a step with no address is not; an address differing from the snapshot's only in case is not
- [x] 2.2 `generateForRoute` attaches the findings to the draft it returns, computed against the same masked snapshot it sent to the model (design D4). Verify with a unit test using an injected snapshot and brain
- [x] 2.3 `renderTestYaml` output is unchanged by the new property. Verify with a test rendering a draft that carries findings and asserting the YAML has no trace of them

## 2b. The password check (design D5)

- [x] 2b.1 `authoring.ts` exports `entersNamedValue(step)`, the positive half of the predicate `detectMissingValues` already uses. Verify the existing authoring tests pass unchanged
- [x] 2b.2 `findSecretLiterals` refuses a credential step without a placeholder when it is quoted **or** enters a named value. Verify with unit tests: the six measured drafts' step `Fill the Password textbox with demo123` is refused; `fill the password field with {{env.TEST_PASSWORD}}` is not; `verify the password field is visible` is not; `type the password` (no value) is not; every case refused today still is
- [x] 2b.3 Replay the real drafts: feed the steps recorded in section 4.2's runs through `findSecretLiterals`. Verify the six literal-password drafts are refused and the four placeholder drafts are not
- [x] 2b.4 Mutation check: remove the `entersNamedValue` branch; remove the `QUOTED_LITERAL` branch. Each must turn at least one test red

## 3. The report

- [x] 3.1 `plan` prints one warning per finding on stderr under the route, before the draft is written or previewed, with the wording from design D3. Verify with a command-level test in both preview and `--write` modes
- [x] 3.2 The draft is still written or previewed, and the exit code is unchanged. Verify in the same tests
- [x] 3.3 A clean draft prints nothing extra. Verify with a command-level test
- [x] 3.4 Mutation check: drop the "absent from the snapshot" condition; compare case-sensitively; refuse the draft instead of reporting. Record which tests go red; each must turn at least one red

## 4. Verification

- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 4.2 Live, #100's reproduction: `blastproof plan --route '/login' --write` against `examples/demo-app` with a real model, several times. Record how often the draft uses a placeholder for the email under the new rule, and that any literal address is reported. The demo's login page has a real form, so this is the case the issue observed
  - *Done 2026-09-27*, `plan --route /login` (preview) against `examples/demo-app`, OpenRouter, `anthropic/claude-haiku-4.5`, 5 runs per prompt. **Old prompt: 0 of 5 drafts used a placeholder, for the email or the password.** Every draft copied `demo@blastproof.dev` and `demo123` from the page's own hint, *"Demo credentials: demo@blastproof.dev / demo123"*. **New prompt: 4 of 5 used `{{env.TEST_EMAIL}}` and `{{env.TEST_PASSWORD}}`.** The fifth copied both literals again, and no warning was printed: the address is on the page, so the check stays silent by design (see design, Risks). None of the six literal passwords was refused by `findSecretLiterals`, which required the value to be quoted; section 2b closes that

## 5. Documentation

- [x] 5.1 `authoring.md`'s "What is enforced" table gains the row from design D5. Verify `tests/skill-manifest.test.ts` passes
