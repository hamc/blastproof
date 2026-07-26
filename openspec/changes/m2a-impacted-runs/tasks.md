# Tasks: m2a-impacted-runs

## 1. Setup

- [x] 1.1 Install `simple-git` and `picomatch` (justified in proposal)

## 2. Diff analysis

- [x] 2.1 `src/diff.ts` — `getChangedFiles(baseRef, cwd)`: three-dot `base...HEAD` diff via simple-git → repo-relative changed paths (incl. deleted/renamed); `DiffError` with actionable messages (invalid ref, not a repo, missing merge-base)
- [x] 2.2 Unit tests for diff.ts (temp git repos with branches; error paths)

## 3. Impact mapping

- [x] 3.1 `src/impact.ts` — `mapImpact(changedFiles, routesConfig)`: picomatch (`dot: true`) matching → sorted de-duplicated affected routes + unmapped file list; pure function
- [x] 3.2 Unit tests for impact.ts (mapping, de-dup, unmapped, empty config)

## 4. Test route coverage

- [x] 4.1 `src/runner/testfile.ts` — optional `routes:` field (default `[]`) parsed/validated and exposed on `TestFile`
- [x] 4.2 Unit tests for the new field (default empty, parses list, rejects non-strings)

## 5. CLI

- [x] 5.1 `run --impacted [--base <ref>]` — diff → impact → intersect with test `routes:`; composes with `--tag/--priority/--query`; unrouted tests skipped + reported; uncovered routes reported + exit 0; empty selection ⇒ no browser, no LLM key required
- [x] 5.2 `run --url <url>` — override config `base_url` for the run (config file untouched)
- [x] 5.3 `run --dry-run` — print affected routes, unmapped files, selected and skipped-unrouted tests; exit 0 without browser/LLM
- [x] 5.4 Unit tests for the impacted selection logic (matching, composition, skip/report paths; mocked diff/impact)

## 6. Samples & scaffold

- [x] 6.1 Init template + repo `.blastproof/tests/*.yaml` gain `routes:` entries consistent with the demo app (login → /login, cart-discount → /cart, app-load → /)

## 7. E2E validation

- [x] 7.1 On a scratch branch, change a file matched by a `routes:` glob → `run --impacted --base main --dry-run` shows the right selection; full `--impacted` run executes only the matching test(s) against the demo app with a real provider; verify no-match case exits 0 with the uncovered-routes report
- [x] 7.2 `npm run build && npm run typecheck && npm test` all green

## 8. Docs

- [x] 8.1 README: document `--impacted`/`--base`/`--url`/`--dry-run` and the `routes:` test field; update AGENTS.md only if conventions change (milestone M2 stays pending until m2b)
