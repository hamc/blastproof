# Tasks: say-when-the-page-reformatted-a-secret

## 1. The comparison

- [x] 1.1 A registered value is matched case-insensitively, with each run of whitespace matched as `\s+` (design D1). Verify with unit tests on `maskSecrets`/`SecretsMask`: #109's three rows — value already uppercase, value lowercased by the test and uppercased by the app, mixed case — all end up redacted
- [x] 1.2 Everything masked today is still masked: byte-identical, percent-encoded, longest-first so a short secret does not redact inside a longer one. Verify the existing `env.test.ts` cases pass unchanged, and add one pinning the longest-first order under the new comparison
- [x] 1.3 The pattern is built once per registered value, not per `mask()` call. Verify by construction (the regex source lives with the value) and keep `mask()` free of per-call allocation beyond the replace itself

## 2. The near-miss

- [x] 2.1 `registerFrom` keeps the variable name alongside the value; `add(value)` without a name stays supported (design D3). Verify with a unit test that a named and an unnamed value both mask
- [x] 2.2 A replacement whose matched text is not byte-identical to the registered value records that variable as near-missed, from inside the replace callback (design D2). Verify with a unit test: a literal match records nothing, an uppercased match records the name
- [x] 2.3 The mask exposes the near-missed names read-only, and never the values. Verify with a unit test asserting the accessor returns names only

## 3. The warning

- [x] 3.1 `run` prints one line per near-missed variable on stderr, after the tests and before the score (design D3). Verify with a run-level test that the text names the variable, contains neither form of the value, and appears once when the same variable was near-missed by several tests
- [x] 3.2 A run with no near-miss prints nothing about it. Verify with a run-level test on a suite whose secret matches literally
- [x] 3.3 A near-miss changes no verdict: same step outcomes, same score, same exit code (design D4). Verify with a run-level test comparing a near-miss run against the same run with a literal-matching value
- [x] 3.4 Mutation check: drop the `found !== value` guard so every redaction warns; drop the per-variable dedup; make the near-miss set carry values instead of names. Record which tests go red for each; each must turn at least one red

## 4. Verification

- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 4.2 #109's reproduction, no key and no model: `captureSnapshot()` against the demo app's promo field with `PROBE_SECRET=hunter2`, through the real `SecretsMask`. Verify the snapshot reads `Unknown promo code "***".` where it read `HUNTER2` before this change
- [x] 4.3 Live agentic run against `examples/demo-app` with a lowercase secret: verify the terminal warning names the variable, the value appears nowhere in the run output or the HTML report, and the run's verdict matches the same suite run with an already-uppercase value
- [x] 4.4 The boundary still bites where it must: a value the page base64-encodes is **not** redacted, and nothing claims it was. Verify with a test, so the limit is pinned rather than assumed

## 5. Documentation

- [x] 5.1 `AGENTS.md`: the masking line states the comparison (case-insensitive, whitespace-tolerant), that a detected near-miss is reported once by variable name, and that an unrecognisable transform is the boundary
- [x] 5.2 README *Trust boundaries*: the same, in the "Your secrets stay out of prompts" paragraph, plus one sentence in the #87 paragraph on what wider masking costs an assertion
- [x] 5.3 `skills/blastproof/references/authoring.md`: under what the runner guarantees versus what it does not, so an agent writing tests reads the same boundary. Verify `tests/skill-manifest.test.ts` passes
