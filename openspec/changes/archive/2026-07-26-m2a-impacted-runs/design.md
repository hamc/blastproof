# Design: m2a-impacted-runs

## Context

M1 delivered the runner (`init`/`run` with the agentic executor). M2 turns blastproof into a PR agent; per the explore session, M2 is sliced into `m2a-impacted-runs` (SENSE + VERIFY: diff → blast radius → run only affected tests) and a later `m2b` (WRITE: planner/generation). This slice is deliberately LLM-free: deterministic globs only, so it is cheap, fast and trustworthy in CI from day one. Single-repository scope: the diff and the suite both live in the current working directory repo (agnostic-by-design extension points under D8).

## Goals / Non-Goals

**Goals:**
- `git diff <base>...HEAD` (three-dot) → changed files (`src/diff.ts`)
- Changed files → affected routes via `routes:` globs + unmapped-file report (`src/impact.ts`)
- Test route coverage declarations (`routes:` in YAML) and intersection matching
- `run --impacted [--base ref] [--url url] [--dry-run]` composing with existing filters

**Non-Goals:** test generation, LLM impact inference, multi-repo/remote diff sources, score gating, GitHub Action.

## Decisions

### D1: Three-dot diff via simple-git
`simple-git`'s `diffSummary` on `<base>...HEAD` (merge-base semantics): reports what the *branch* changed, immune to unrelated commits landing on `main` after the branch point — the correct semantics for PR analysis. Two-dot was rejected (includes base-side drift). Shelling out to `git` manually was rejected (parsing/escaping edge cases; simple-git is already in the approved stack). `diff.ts` exposes `getChangedFiles(baseRef, cwd): Promise<string[]>`, throwing a `DiffError` with an actionable message on invalid refs, non-repo directories and missing merge-base.

### D2: picomatch for glob evaluation
Config `routes:` globs (e.g. `"src/cart/**"`) are matched against changed paths with `picomatch` (`{ dot: true }` so dotfiles are covered too). Picomatch is the minimal standard matcher; alternatives (micromatch, minimatch) add weight without benefit. Matching is case-sensitive, paths normalized to forward slashes before matching.

### D3: URLs are the join key between code and tests
Impact flows through one shared vocabulary — the route string:
- config `routes:` maps file globs **→ URLs** (what can break)
- test `routes:` declares the test **→ URLs** (what is covered)
- impacted tests = tests whose `routes:` ∩ affected routes ≠ ∅
Route strings compare by exact equality (no normalization/canonicalization in this slice); document that `"/cart"` and `"/cart/"` are different strings and should be written consistently.

### D4: Unrouted tests are skipped and reported under `--impacted`
A test without `routes:` has unknown coverage; silently running it would negate the point of impacted runs, silently skipping it would hide a coverage gap. So: skip + list under "unrouted tests (skipped)". Plain `run` (no `--impacted`) is unaffected — full backward compatibility for existing suites.

### D5: Uncovered routes report, never fail
Affected routes with zero covering tests are listed as "affected but uncovered" and the run exits 0. Failing would punish users for an incomplete `routes:` map instead of teaching them to complete it. When the final selection is empty, no browser is launched and no LLM key is required.

### D6: `--url` overrides config `base_url` for the run
Precedence: CLI flag > config file. Needed to point impacted runs at preview/review environments without editing config. Config file is never mutated by the flag.

### D7: `--dry-run` prints the selection plan
Affected routes, unmapped files, selected tests, skipped-unrouted tests — then exit 0 without browser/LLM. This is the cheap debugging tool for tuning globs in CI.

### D8: Agnostic by design, simple by default (extension points)
Both integration seams are implicit today but isolated behind small interfaces so polyrepo support lands later without redesign:
- **Diff source**: `diff.ts` takes `(baseRef, cwd)` — a future `--repo`/`--base` remote mode adds fetching in front of the same function.
- **Suite location**: discovery takes a tests directory (`.blastproof/tests` today) — a future `--tests <path>`/`tests_source` points it elsewhere.
No CLI surface for these in this slice; only the internal seam.

## Risks / Trade-offs

- Shallow CI clones lack merge-base → `diff` fails → Mitigation: `DiffError` names the cause and the fix (`git fetch --deepen` / `fetch-depth: 0` in actions/checkout).
- Over-broad globs (e.g. `"src/**"`) make every run "impacted" → Mitigation: `--dry-run` + unmapped/affected reports make glob quality visible.
- Exact-string route equality surprises users (`/cart` vs `/cart/`) → Mitigation: documented in D3 + init template examples written consistently.
- `simple-git` in non-repo cwd throws generic errors → Mitigation: wrap in `DiffError` with actionable text before any browser launch (exit 2).

## Migration Plan

Additive only. Existing suites keep working (`run` unchanged); `--impacted` is opt-in. Sample tests in `.blastproof/tests/` and the init scaffold gain `routes:` examples.

## Open Questions

(none — matching semantics, no-match behavior and skip-vs-run for unrouted tests were settled in the explore session)
