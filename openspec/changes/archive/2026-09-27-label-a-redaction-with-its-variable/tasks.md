# Tasks: label-a-redaction-with-its-variable

## 1. The label

- [x] 1.1 `SecretsMask.mask` replaces each match with `[redacted NAME]` for a named value and `[redacted]` for an unnamed one (design D1, D2). Verify with unit tests: literal, uppercased near-miss and percent-encoded forms of one value all get that value's label; two values get two labels; the output contains no form of either value
- [x] 1.2 `maskSecrets` (the free function) keeps a stable output for callers without names. Verify its existing tests, updated from `***` to `[redacted]`
- [x] 1.3 Longest-first and the near-miss record from #109 are unchanged. Verify the existing tests pass with only the token updated

## 2. The refusal

- [x] 2.1 A `fill` or `select` value containing `[redacted` is refused in `recovery.ts` with the explanation from design D3. Verify with unit tests: a full label, a partial one and a label inside other text are refused; `{{env.X}}` named by the step is admitted; `press` is unaffected
- [x] 2.2 Executor-level: a model proposing to fill with a label copied from the snapshot gets the refusal, and nothing reaches the page. Verify with an executor test using a scripted brain

## 3. The prompts

- [x] 3.1 The executor and judge prompts describe labels as in design D4, including "different labels are different values" and "never type a label". Verify with prompt tests asserting those phrases and the absence of the `***` description
- [x] 3.2 `init`'s scaffold comment says values are masked as their label. Verify the init test

## 4. Existing tests

- [x] 4.1 Every test pinning `***` is updated to the label it now produces. Verify by grep that no test asserts on `***` as the mask's output
  - *Done.* The `***` left in `executor.test.ts` are stub masks injected into the executor (`s.replaceAll('s3cret', '***')`). Those tests pin that the executor applies whatever mask it is given, not what `SecretsMask` produces, so they stay. The two fixtures that stood for an already-masked snapshot were updated to labels

## 5. Verification

- [x] 5.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 5.2 Mutation check: return the old `***`; drop the refusal; label from the matched text instead of the registered value. Each must turn at least one test red
  - *Done.* Back to `***`: 15 red. Refusal removed: 2 red. The encoded form losing its name: 2 red. (A first version of the third mutation referenced a variable out of scope and failed with a `ReferenceError`, not on the behaviour; it was discarded and replaced by this one)
- [x] 5.3 Live, the proposal's experiment rerun unchanged (`exp87`: true and false assertions, 3 runs each). Verify the true one passes and the false one fails, and that neither log contains `HUNTER2` or `SAVE99`
  - *Done 2026-09-27*, same `exp87` harness, OpenRouter, `anthropic/claude-haiku-4.5`. Before: true 3/3 PASS, false **3/3 PASS**. After: true 3/3 PASS, false **3/3 FAIL**, the judge citing *"these are two different redacted values"*. Neither value appears in any log
- [x] 5.4 Live, the repository's dogfood suite against `examples/demo-app`. Verify nothing regresses
  - *Done.* 8 of 8, Score 100, 94 model calls. That suite uses no `{{env.*}}`, so it checks the prompt change on the common path, not the label itself

## 6. Documentation

- [x] 6.1 README: the #87 paragraph is rewritten, since a value in `{{env.*}}` is now assertable by identity; *Trust boundaries* shows the label
- [x] 6.2 `docs/auth.md` and `AGENTS.md` describe the label where they describe `***`
