# Tasks: steps-name-their-value

## 1. Detection (pure)

- [x] 1.1 Add `src/runner/authoring.ts` with `detectMissingValues(tests): AuthoringResult` plus `AuthoringFinding` types. Read `steps` and `setup` from each `TestFile` (D2), fire only when a closed-set verb (`fill`, `enter`, `type`, `input`, `set`) matches on a word boundary and the step carries **no connector** (D3) — `with`, `to`, `as`, `using`, `into`, `from`, `in`, `:`, `=`, a quote, or `{{env.`, with `in` discounted when adjacent to the verb so `fill in` stays a bare step. Findings carry the test, whether the step came from `steps` or `setup`, its 1-based index and its text; grouped by test in input order, then step order. Pure — no I/O, no config, no CLI.
- [x] 1.2 Add `suggestValueClause(step): string` in the same module: the offending step with a value clause appended, as the shape to follow (D6). It never invents a value.
- [x] 1.3 Unit tests in `tests/authoring.test.ts` covering every scenario in `specs/test-authoring/spec.md`: bare `fill`, `with` clause, `{{env.*}}`, page-sourced value, quoted value, `set … to High`, `enter … in the subject field`, `fill in the note field` (phrasal verb still reported), `setup` coverage, `setup the account` not matching `set`, a non-value step, and grouping/order stability. Add one test per verb and one per connector so dropping either fails.
- [x] 1.4 Run the detector over `.blastproof/tests/*.yaml` and `examples/**` as a fixture test: the project's own suite must produce zero findings. It is the only corpus of real steps the repo has, and a check that fires on it is wrong.

## 2. Surfacing

- [x] 2.1 In `src/commands/run.ts`, add `printAuthoring(result, cwd)` writing to stderr: the test, the step's origin and position, its text, why the executor cannot carry it out, and the corrected shape from 1.2 (D6).
- [x] 2.2 Compute findings once after the parse loop and print from a **single unconditional call site**, beside `printRouteDrift` (D5, inherited from `route-drift-warning`). No `if (dryRun)` guard, no second call site — a future code path must not be able to bypass it.
- [x] 2.3 Tests in `tests/run.test.ts`: plain `run`, `--dry-run`, and `--impacted --dry-run` each warn exactly once; a clean suite prints nothing; stdout stays clean; exit code unchanged in all four. Use the empty-selection trick (`--tag` no test declares) to reach the real path without a browser or key.

## 3. The gate

- [x] 3.1 Add `--fail-on-authoring` to `run` and `test` in `src/cli.ts` and thread `failOnAuthoring` through `RunOptions`/`TestOptions` (D7). No companion-flag validation — unlike `--fail-on-unmapped`, this needs no `--impacted`.
- [x] 3.2 In `run.ts`, return `EXIT_FAILED` when the flag is set and findings exist, positioned after parsing and **before** preflight, browser launch and any key check, so the gate costs nothing when it fires (D7).
- [x] 3.3 Tests: gate exits 1 with no browser launched and no key required; gate passes a clean suite through to the normal exit code; gate accepted without `--impacted`; the warning still prints when the flag is absent.

## 4. Rule-drift guard (#45)

- [x] 4.1 Add a test asserting the rule's key phrase appears in `plannerSystemPrompt` (`src/llm/prompts.ts`), in the README's test-authoring section, and in the check's own message — failing and naming which two disagree when they diverge (D8). Precedent: `tests/action-manifest.test.ts`.

## 5. Docs

- [x] 5.1 README: document the check and `--fail-on-authoring` in the flag list and beside the existing *Writing tests* rule. Keep the wording consistent with 4.1, which will fail otherwise. Do not edit `CHANGELOG.md` — it is written at release time (CONTRIBUTING.md:22).
- [x] 5.2 README: state plainly that the check is English-only and that a non-English suite receives no warning that it went unchecked (D9). Not a footnote — a reader must not infer coverage that does not exist. Add a regression test asserting the check's own message and the README agree on this, alongside 4.1.
- [x] 5.3 `action.yml`: add the input if the flag is exposed to the Action, or record in the PR why it is not. `tests/action-manifest.test.ts` asserts the manifest and CLI agree (#30).

## 6. Verification

- [x] 6.1 `npm run build`, `npm run typecheck`, `npm test` all green.
- [x] 6.2 Run the built CLI (`dist/cli.js`) against a scratch project with one offending test and one clean test: confirm the warning fires on all three paths, `--fail-on-authoring` exits 1 with no key set, and `grep -c` shows the warning printed exactly once per path.
- [x] 6.3 Confirm the PR body says **`Part of #44`**, never `Closes #44` — the headline no-outcome rule is phase 2 and stays open. #45 also stays open; 4.1 is a guard, not the single source it asks for.
