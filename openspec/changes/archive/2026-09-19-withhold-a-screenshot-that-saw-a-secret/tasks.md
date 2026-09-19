# Tasks: withhold-a-screenshot-that-saw-a-secret

## 1. The decision

- [x] 1.1 `SecretsMask` answers whether it holds any value, read-only, and says nothing about which. Verify with a unit test: empty after construction, non-empty after `registerFrom` on a step with a placeholder, and still empty after `add('')`
- [x] 1.2 `HtmlMeta.screenshots` is a required `'embed' | { withheldRelativeTo: string }` (design D2). Verify with `npm run typecheck`: every existing `renderHtml` call, tests included, fails until it states one

## 2. The report

- [x] 2.1 With `'embed'`, behaviour is unchanged. Verify that the existing *embeds a screenshot inline* and *degrades gracefully* tests pass with only the new field added
- [x] 2.2 With `withheldRelativeTo`, a failed test with a screenshot shows the withheld note and an `<a href>` to the path relative to that directory, with forward slashes and HTML-escaped. `embedScreenshot` is never called (design D3). Verify with a test that writes a fixture PNG and asserts the report contains no `data:`, no `<img`, and no base64 of the fixture's bytes
- [x] 2.3 The link is relative, not absolute. Verify with a test where the report directory and the screenshot sit in different subtrees: the href contains `..` segments and does not contain the temp root's absolute path
- [x] 2.4 The footer reads from the same value (design D5). Verify with a test that the withheld report does not contain "Screenshots are embedded" and the embedded one does
- [x] 2.5 A withheld test whose screenshot file does not exist still gets the note and link, since nothing is read. Verify with a test

## 3. The caller

- [x] 3.1 `run` passes `'embed'` when the run mask is empty, otherwise `{ withheldRelativeTo: path.dirname(target) }`, where `target` is the report path already computed for `--html`. Verify with a run-level test covering both the default target and an explicit `--html` path
- [x] 3.2 D1, pinned: a config whose only placeholder is in `auth.steps`, and a failed test that references none, still withholds. Verify with a run-level test
- [x] 3.3 Mutation check: make the field optional with an `'embed'` default, switch the condition to the failed test's own placeholders, and call `embedScreenshot` before the branch. Record which tests go red for each. Each must turn at least one red

## 4. Verification

- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 4.2 Live, #110's reproduction against `examples/demo-app`: fill the promo field from `{{env.PROBE_SECRET}}=HUNTER2`, fail the test, write `--html`. Verify that `grep -c 'data:image' report.html` is 0, the link opens the PNG from the report's directory, and the PNG itself still shows the value (the capture is unchanged by design)
  - *Done 2026-09-19* via `blastproof run --html`, `provider: openai` through OpenRouter, `anthropic/claude-haiku-4.5`. The failed test's PNG (26,205 bytes) shows `HUNTER2` in the field and in `Unknown promo code "HUNTER2".`. Default report: 0 `data:image`, 0 `HUNTER2`, a link to the PNG's file name that resolves, and the withheld footer. With `--html build/report.html` the link is `../.blastproof/reports/<session>/…png` and also resolves
- [x] 4.3 Live, same app, a suite with no `{{env.*}}`: the report still embeds the image and opens offline after being copied elsewhere
  - *Done 2026-09-19*, same setup with the `{{env.*}}` test moved out of the project, since the mask covers every *loaded* test, not only the selected ones. Report: 1 `data:image`, no links, the "embedded" footer. A copy moved out of the project keeps the image and has no `src`/`href` other than `data:`

## 5. Documentation

- [x] 5.1 `AGENTS.md:84` and `:86`: masking covers text channels. Screenshots are not masked and are withheld from the HTML report when the run held a secret. Verify by reading both lines against the spec
- [x] 5.2 README *Trust boundaries*: the same limit, in the "Your secrets stay out of prompts" paragraph, in words someone about to attach a report to a PR would act on
- [x] 5.3 `docs/ci.md` (design D6): the upload snippet uploads `report.html` only, followed by a note that `.blastproof/reports/` holds unmasked screenshots. Also fix the "links the failure screenshot" sentence so it matches both branches
- [x] 5.4 `skills/blastproof/references/cli.md:36` and the `action.yml` `html` input still say "self-contained". Keep the wording accurate, and verify with `tests/skill-manifest.test.ts` and the action drift guard
