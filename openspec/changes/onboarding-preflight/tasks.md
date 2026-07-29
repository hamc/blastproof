## 1. Browser launch failures explain themselves

- [x] 1.1 Add a launch helper that wraps `chromium.launch`, recognises the common causes — a missing shared library, a browser that was never installed — and raises an actionable error naming the remedy and that system libraries need elevated privileges.
- [x] 1.2 Never print the browser's command line. The Chrome argv appears twice in Playwright's exception and is what buries the one useful line.
- [x] 1.3 An unrecognised cause keeps the underlying error (design D4), so an unanticipated failure is never swallowed to look tidy.
- [x] 1.4 Use it at both launch sites: `src/commands/run.ts:584` and `src/commands/plan.ts:210`.

## 2. Preflight

- [x] 2.1 Add a preflight module that checks browser launch, provider reachability and `base_url` responding, returning **all** failures rather than throwing on the first (design D2).
- [x] 2.2 Keep every check shallow (design D6): a connection attempt, not a credential validation or a model invocation. A false failure here blocks a run that would have worked, which is worse than the dump it replaces.
- [x] 2.3 Run it at the start of `run`, `plan` and `test`, selecting checks by what the command will actually spend (design D3) — `--dry-run` must remain fully keyless and browserless.
- [x] 2.4 Reuse the browser launch rather than launching twice.
- [x] 2.5 Silent when everything passes.

## 3. Unknown configuration keys

- [x] 3.1 Detect keys absent from the schema during load and warn, naming each key. Do not fail (design D5) — a config written for a newer version must still run on an older one.
- [x] 3.2 Cover nested sections, so an unknown key inside `budget:` or `llm:` is caught too.
- [x] 3.3 Test the case that prompted this: a configured section the running version does not support warns instead of being silently discarded.

## 4. `plan --dry-run`

- [x] 4.1 Add `--dry-run` to `plan` in `src/cli.ts`.
- [x] 4.2 Report the routes it would generate for and those already covered, without launching a browser or calling the model; exit 0.
- [x] 4.3 Test that it succeeds with no provider key configured.

## 5. Tests for the failure paths

- [x] 5.1 Browser launch: a missing shared library, and a missing executable, each asserted on the message and its remedy — not merely on the fact that it failed. A test asserting only failure would pass against today's raw dump.
- [x] 5.2 Preflight with two failures at once reports both.
- [x] 5.3 Preflight silent when all checks pass; and a dry run performs neither the browser nor the model check.
- [x] 5.4 Unknown key warns and the run continues.

## 6. Verification

- [x] 6.1 `npm run build`, typecheck and the full vitest suite green.
- [x] 6.2 Reproduce the original experience by hand: with the system libraries absent, confirm the output is the actionable message rather than the forty-line dump. This is the finding; a green unit test alone does not demonstrate it is fixed.
  - Reproduced on a machine with the system libraries genuinely absent: 4 lines of output, zero Chrome argv, both the browser and the dead `base_url` reported together. Was ~40 lines with the command line printed twice.
- [x] 6.3 Dogfood: an ordinary run still passes with score 100 and preflight prints nothing.
  - Verified on `fix/onboarding-preflight`, dogfood run `30495195305`: `5 passed, 0 failed, 5 total`, `Score: 100 — min-score 80: pass`, and zero preflight or unknown-key output. Preflight is silent when every prerequisite is met.

## 7. Documentation

- [x] 7.1 README: mention that prerequisites are checked up front, in the Quick start where the sudo caveat already lives.
- [x] 7.2 CHANGELOG under Unreleased.
- [x] 7.3 Note in `AGENTS.md` that error messages at the prerequisite boundary are held to the standard the missing-key message set.
