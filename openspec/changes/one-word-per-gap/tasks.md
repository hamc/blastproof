# Tasks: one-word-per-gap

## 1. The report

- [x] 1.1 `printImpactReport`: the opening "Not covered" line, the three groups in pipeline order, the base ref in the header, gaps marked in place; it receives the number of changed files (design D1, D2)
- [x] 1.2 Ignored files: the count and the first three names, then "and N more" (design D3)
- [x] 1.3 Tests: the old headings' assertions rewritten; new ones for the opening line with and without gaps, `/checkout` printed once, the filtered-route wording, the ignored-file cut-off

## 2. Specs and documentation

- [x] 2.1 `impact-mapping` and `cli-run-command` deltas (design D4)
- [x] 2.2 README and docs wherever they quote the report's words, the CHANGELOG
- [x] 2.3 `npm run build`, `npm run typecheck`, `npm test` pass
- [x] 2.4 Archive in the same pull request, as its own commit
