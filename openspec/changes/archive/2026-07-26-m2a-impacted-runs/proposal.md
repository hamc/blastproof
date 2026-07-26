# Proposal: m2a-impacted-runs

## Why

Running the full YAML suite on every change does not scale, and PR authors get no signal about which journeys their diff actually touches. M2 is the milestone that turns blastproof into a PR agent; this is its first, lowest-risk slice (SENSE + VERIFY, no test generation): compute the blast radius of a change and run only the tests that cover it.

## What Changes

- Add `src/diff.ts`: `git diff <base>...HEAD` (three-dot, merge-base) in the current repository, returning changed file paths (via `simple-git`)
- Add `src/impact.ts`: maps changed files to affected routes using the `routes:` globs in `.blastproof/config.yaml`; files not matched by any glob are reported as "unmapped" (never a failure)
- Add optional `routes:` field to the YAML test format: a test declares the routes/URLs it covers
- Add `blastproof run --impacted --base <ref>`: executes only tests whose `routes:` intersect the affected routes
- Add `--url <url>` override on `run`: points the run at a review/preview environment instead of config `base_url`
- No-match behavior: when no test covers the affected routes, the CLI reports affected-but-uncovered routes and exits 0
- Add `--dry-run`: prints the impacted selection without executing (cheap CI debugging)

## Capabilities

### New Capabilities

- `diff-analysis`: computing the changed-file set for a PR from the local git repo
- `impact-mapping`: mapping changed files to affected routes and reporting uncovered/unmapped surface

### Modified Capabilities

- `yaml-test-format`: new optional `routes:` field declaring route coverage per test
- `cli-run-command`: new `--impacted`/`--base`/`--url`/`--dry-run` flags and the no-match reporting behavior

## Non-goals

- No test generation/planner, no `plan`/`test` commands (that is m2b)
- No LLM fallback for unmapped files in this slice (globs only; reported instead)
- No multi-repo support: diff and suite are local to the current repository (extension points documented in design for a later change)
- No score/`--min-score` gating (M3), no GitHub Action (M4)

## Impact

- New dependencies: `simple-git` (already in the approved stack in AGENTS.md; the standard, minimal Node git wrapper — avoids shelling out to git manually and parses status/diff safely) and `picomatch` (the de-facto standard minimal glob matcher, used by micromatch/chokidar; needed to evaluate `routes:` globs against changed paths — Node has no built-in glob matcher). Dev-only: `@types/picomatch` (types companion — picomatch v4 ships no bundled types; compile-time only, never shipped to users)
- Affects: `src/` (new `diff.ts`, `impact.ts`; `cli.ts`, `commands/run.ts`, `runner/testfile.ts` extended), `tests/`, `.blastproof/tests/` samples gain `routes:`, README/AGENTS.md milestone status on completion
