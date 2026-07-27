# Tasks: m3b-html-and-test

## 1. HTML report

- [x] 1.1 `src/report/html.ts` — `escapeHtml(text)` covering `& < > " '`, applied at every interpolation point (design D4)
- [x] 1.2 `src/report/html.ts` — `embedScreenshot(path)`: reads the PNG and returns a base64 `data:` URI, resolving to `undefined` when unreadable so the report never fails while explaining a failure (design D3)
- [x] 1.3 `src/report/html.ts` — `renderHtml(results, skipped, meta)`: inline CSS, score and gate verdict first, failures before passes, passing tests inside collapsed `<details>`, per-test steps, failing step, reason and embedded screenshot (design D3/D5)
- [x] 1.4 `src/report/html.ts` — `writeHtml(path, html)`: creates missing parent directories, returns the written path
- [x] 1.5 Unit tests: no external URLs in the output, script tags in a summary rendered inert, score and verdict present, failure detail present, unreadable screenshot degrades gracefully, skipped tests listed

## 2. Wiring `--html` into `run`

- [x] 2.1 `src/commands/run.ts` — `--html [path]` in `finalize`, mirroring the JUnit branch exactly (design D6); nothing written when the flag is absent
- [x] 2.2 `src/cli.ts` — register `--html [path]` on `run`
- [x] 2.3 Unit tests: default destination, explicit path, both reports together, no file without the flag

## 3. The `test` command

- [x] 3.1 `src/commands/test.ts` — `testCommand(options)`: load config, diff, impact; execute impacted tests via the shared run path; generate drafts for uncovered routes without executing them (design D1)
- [x] 3.2 `src/commands/test.ts` — reporting that separates executed tests from drafted routes, and draft persistence honouring `--write` and the no-overwrite rule
- [x] 3.3 `src/commands/test.ts` — exit codes: 2 usage/config/diff, 1 gate failure **or** draft generation failure, 0 otherwise (design D2)
- [x] 3.4 `src/cli.ts` — register `test` with `--base`, `--url`, `--min-score`, `--junit [path]`, `--html [path]`, `--write`
- [x] 3.5 Unit tests with mocked diff, browser and brain: impacted run plus drafting, drafts excluded from the score, preview vs `--write`, generation failure exits 1 with passing tests, nothing-affected exits 0

## 4. Docs

- [x] 4.1 README: document `test` and `--html`; state plainly that drafts are never executed and that `test` makes a coverage gap visible rather than closing it; fix the line that advertises `test` as if it already existed
- [x] 4.2 `AGENTS.md`: mark M3 done, add `report/html.ts` and `commands/test.ts` to the architecture block
- [x] 4.3 `CONTRIBUTING.md`: the spec-driven workflow, how to run build/test/typecheck, commit conventions, and what a good pull request looks like here (design D7)

## 5. Verification

- [x] 5.1 Against `examples/demo-app` with a real provider: `test` executes impacted tests and drafts an uncovered route; the HTML report opens standalone with an embedded screenshot from a forced failure
- [x] 5.2 `npm run build && npm run typecheck && npm test` all green
