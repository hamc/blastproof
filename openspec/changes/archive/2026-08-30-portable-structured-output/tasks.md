# Tasks: portable-structured-output

## 1. Express absence in the portable subset

- [x] 1.1 `src/llm/schemas.ts` — a small local helper: `.nullable()` on the wire, `.transform((v) => v ?? undefined)` on parse, so `z.infer` is unchanged (design D1)
- [x] 1.2 Apply it to all six optional fields of `agentActionSchema`: `target` itself, its `role`/`name`/`text`, `value` and `expectation`. Checked rather than assumed — the other two schemas declare no optional fields, so they are untouched
- [x] 1.3 Unit test: an object with `null` for every absent field parses, and every one of those fields reads `undefined` afterwards
- [x] 1.4 Unit test: the generated JSON Schema lists every key of `target` in `required`. This is the property a strict provider checks, and asserting the parsed value alone would pass while the request still failed

## 2. Let the provider speak

- [x] 2.1 Surface `AI_APICallError`'s `responseBody` where the error is currently flattened to `Provider returned error` (design D2)
- [x] 2.2 Keep it bounded — a raw body can be long, and a step's failure line is read in a terminal
- [x] 2.3 Unit test: an error carrying a provider explanation reports that explanation; one carrying none still reports something useful rather than an empty string

## 3. Verification

- [x] 3.1 Live, one `generateObject` per provider with the real schema: `gpt-4o-mini`, `claude-haiku-4.5` and `gemini-2.5-flash-lite` all accepted it and all parsed to an object carrying `undefined` where a field was absent
- [x] 3.2 Live, the full search test against OWASP Juice Shop on the OpenAI default: **0 model calls before, 9 after**. The run still fails the test — `gpt-4o-mini` is a weak model on a hard journey — but it fails having been asked, which is the whole of what this change claims
- [x] 3.2a `claude-haiku-4.5` must not regress: full test PASS, 21 calls, 49k tokens
- [x] 3.2b `gemini-2.5-flash-lite` end-to-end: the leg returned late, after the PR had been opened saying it had not. It made **3 calls** and failed the test at 275s — so the schema is accepted and the model is being asked, which is what this change is about. No before/after comparison exists for its full test: gemini accepted the schema before this change too, so there was nothing here to fix and nothing measured to regress
- [x] 3.3 Mutation: restore one `.optional()` and confirm 1.4 fails — the JSON Schema assertion is the one that protects this, and a test that passes on the parsed value alone would not have caught the original defect
- [x] 3.4 `npm run build`
- [x] 3.5 `npm run typecheck`
- [x] 3.6 `npm test`
