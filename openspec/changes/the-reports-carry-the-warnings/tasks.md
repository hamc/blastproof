# Tasks: the-reports-carry-the-warnings

## 1. One shape

- [x] 1.1 `RunWarning` and `emitWarning`; split `printUncommitted`, `printRouteDrift`, `printAuthoring` and `reportNearMissedSecrets` into builders and one emitter, with the terminal output unchanged (existing tests pass untouched) (design D1)
- [x] 1.2 `runCommand` collects the run's warnings and passes them to `finalize`; `plan` keeps printing the uncommitted warning (design D5)

## 2. The reports

- [x] 2.1 `junit.ts`: the `warnings` property, always, and the suite's `<system-err>` when there are any, escaped; tests for none, one, and several kinds (design D2)
- [x] 2.2 `html.ts`: the Warnings section after the score, escaped, absent when empty, with a `--warn` token for light and dark; tests (design D3)
- [x] 2.3 A `run` test end to end: a drifted route and an unnamed value reach both reports with the text the terminal printed; a clean suite's reports carry none

## 3. Documentation and wrap-up

- [x] 3.1 README's reports section, the JUnit properties in `docs/`, the CHANGELOG
- [x] 3.2 `npm run build`, `npm run typecheck`, `npm test` pass
- [x] 3.3 Archive in the same pull request, as its own commit
