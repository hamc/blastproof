# Design: m2b-test-planner

## Context

m2a delivered SENSE + VERIFY: `run --impacted` computes the diff, maps changed files to affected routes, runs the tests that cover them, and reports `uncoveredRoutes` — affected routes no test covers. That report is a dead end today. This slice is M2's WRITE half: it consumes `uncoveredRoutes` and produces plain-English YAML test drafts. The runner (`executor.ts`), the snapshot layer (`snapshot.ts`) and the structured-output layer (`llm/brain.ts`) already exist and are reused as-is; single-repository scope carries over from m2a (design D8 there).

## Goals / Non-Goals

**Goals:**
- Generate a runnable YAML test for a route, grounded in the page's real accessibility tree
- `blastproof plan [--base <ref>] [--url <url>] [--route <route>] [--write]`
- Preview by default; `--write` persists to `.blastproof/tests/` and never overwrites
- One route's failure never aborts the others

**Non-Goals:** the `test` composite command, updating existing tests, LLM-suggested `routes:` globs, executing what was generated, score gating, GitHub Action.

## Decisions

### D1: Uncovered routes are the input, `--route` is the bypass
`plan` runs the same diff → `mapImpact` pipeline as `run --impacted`, then generates for `selection.uncoveredRoutes` — the routes the suite provably does not cover. Generating for *all* affected routes was rejected: it would re-generate tests that already exist and turn every PR into duplicate coverage. `--route <route>` (repeatable) skips diff and impact entirely and generates for the named routes, which is how a user bootstraps coverage on an app with no suite yet. `--route` and `--base` are mutually exclusive in meaning; when `--route` is given the diff is never computed (no git repo required).

### D2: Two-source grounding — live snapshot + changed-file context
Each generation call sees (a) the trimmed `ariaSnapshot` of the route, captured by actually loading it in Chromium, and (b) the list of changed files that mapped to this route. The snapshot is what makes generated steps executable: the model names buttons and fields that demonstrably exist, so the runner's role/name resolution finds them on the first run. The changed-file list is what makes the test *relevant* to the PR rather than a generic tour of the page. Snapshot-only was rejected (produces plausible tests unrelated to the change); diff-only was rejected (the model invents control names and most drafts fail on first execution, which destroys trust in the feature).

### D3: Diff context is file paths, not hunk contents
Only the repo-relative paths of the changed files that matched this route's globs go into the prompt — never the diff body. Hunks would multiply token cost per route and would pipe source code, including anything hard-coded in it, into the prompt. Paths plus the route are enough signal for "which area of the app changed"; the snapshot supplies everything about *what is on screen*.

### D4: One page load per route, no crawling
The planner navigates to `base_url + route`, waits for load, captures one snapshot, and makes exactly one LLM call. It does not click through the page to discover deeper states. An agentic crawl would produce richer journeys but makes cost and runtime unbounded and non-reproducible — the opposite of what a PR-time tool needs. Depth beyond the landing state is the user's to add when reviewing the draft.

### D5: Structured generation reuses the brain pattern
A `generatedTestSchema` (Zod) in `llm/schemas.ts` describes `summary`, `steps`, `priority`, `tags`; a `PlannerBrain` interface with a single `planTest(input)` method lives beside `AgentBrain` in `llm/brain.ts`, built by `createPlanner(model, generate)` with the same injectable `GenerateObjectFn`. This keeps stubbing in unit tests identical to the executor's and avoids a second, divergent LLM call path.

### D6: `routes:` is set by the planner, not the model
The generated file's `routes:` is always exactly the route being generated for. Letting the model choose would let it emit a test that does not close the coverage gap that triggered generation — the one invariant this feature must hold. `summary`, `steps`, `priority` and `tags` come from the model; `routes:` is code.

### D7: Preview by default, `--write` persists, collisions are errors
Without `--write`, drafts print to stdout as YAML and nothing touches disk. With `--write`, each draft is written to `.blastproof/tests/<slug>.yaml` where the slug derives from the route (`/` → `home`, `/cart/discount` → `cart-discount`, non-alphanumerics collapsed to `-`). If the target file exists, that route fails with an error naming the existing file — the planner never overwrites, so an unreviewed regeneration cannot silently replace a human-edited test. Every written file opens with a comment header recording the route, base ref and generation date, so provenance is visible in review and in `git blame`.

### D8: Secrets stay placeholders
Steps that need a credential must be emitted as `{{env.VAR_NAME}}` placeholders, never literal values — the prompt states this and generated output is checked for it. This keeps generated files consistent with the masking guarantee the runner already provides (`runner/env.ts`).

### D9: Per-route isolation and exit codes
A route that fails to load, times out, or yields malformed model output is reported and skipped; the remaining routes still generate. Exit 0 when every requested route generated (and when there was nothing uncovered to do), 1 when at least one route failed, 2 on usage/config/diff errors. The browser is launched once for the whole run and closed in a `finally`, mirroring `runCommand`.

### D10: Config and URL handling reuse `run`
`--url` reuses the exported `applyUrlOverride` (m2a design D6): CLI flag > config file, config never mutated. The API-key check happens before the browser launch, as in `run`, so a missing key fails fast — except when there is nothing to generate, where no key is required.

## Risks / Trade-offs

- Model produces steps the runner cannot execute → Mitigation: snapshot grounding (D2) plus preview-by-default (D7); the user reviews and runs before committing.
- An auth-walled route snapshots as a login page, so the draft tests the login wall instead of the feature → Mitigation: documented limitation; the `auth` recipe in config is not consumed by the planner in this slice, and the draft is reviewable before it lands.
- Many uncovered routes ⇒ many page loads and LLM calls → Mitigation: cost is one load + one call per route and the uncovered set is bounded by the diff; `--route` narrows it explicitly.
- Route slugs can collide across distinct routes (`/a/b` and `/a-b`) → Mitigation: collisions are hard errors naming the existing file (D7), never silent overwrites.
- Generated tests could drift into low-value "smoke" drafts → Mitigation: the changed-file context (D2) steers toward the changed area; priority and tags come from the model and are reviewable.

## Migration Plan

Purely additive. `run`, the YAML schema and existing suites are untouched; `plan` is a new command and generated files are ordinary test files. Nothing to roll back beyond deleting generated drafts.

## Open Questions

(none — grounding, write policy, command surface and glob-suggestion scope were settled before this proposal)
