# Tasks: m2b-test-planner

## 1. Generation schema and prompts

- [x] 1.1 `src/llm/schemas.ts` — `generatedTestSchema`: `summary` (non-empty), `steps` (non-empty list of plain-English strings), `priority` (P0|P1|P2), `tags` (list), each field `.describe()`d for the model; no `routes` field (set by code, design D6)
- [x] 1.2 `src/llm/prompts.ts` — `plannerSystemPrompt()` / `plannerUserPrompt({ route, snapshot, changedFiles })`: instruct plain-English steps grounded in the snapshot's accessible names, steer toward the changed area, require `{{env.VAR}}` placeholders for credentials and forbid literal secrets and static selectors
- [x] 1.3 `src/llm/brain.ts` — `PlannerBrain` interface with `planTest(input)` plus `createPlanner(model, generate = generateObject)`, reusing the existing injectable `GenerateObjectFn`; throw `MalformedModelOutputError` on schema mismatch
- [x] 1.4 Unit tests for `createPlanner` (stubbed generate: valid output parsed, malformed output throws) and for prompt composition

## 2. Planner core

- [x] 2.1 `src/planner.ts` — `generateForRoute(page, { route, baseUrl, changedFiles, brain }): Promise<GeneratedTest>`: navigate to `baseUrl + route`, `captureSnapshot`, one `planTest` call, return the draft with `routes` set to exactly that route
- [x] 2.2 `src/planner.ts` — `routeToSlug(route)` (`/` → `home`, non-alphanumerics collapsed to `-`, lowercase) and `renderTestYaml(draft, { route, base })` emitting the provenance comment header + YAML body
- [x] 2.3 `src/planner.ts` — `writeDraft(cwd, draft)`: writes `.blastproof/tests/<slug>.yaml`, throwing a `PlannerError` naming the existing path if the file already exists (never overwrite)
- [x] 2.4 Unit tests: slug derivation (incl. `/` and nested routes), YAML render round-trips through `parseTestFile`, `routes:` always equals the requested route, write refuses to overwrite, secret-placeholder check

## 3. CLI

- [x] 3.1 `src/commands/plan.ts` — `planCommand(options)`: load config, `applyUrlOverride`; with `--route` skip diff/impact, otherwise `getChangedFiles` → `mapImpact` → uncovered routes via the existing selection logic; short-circuit with exit 0 and no browser when there is nothing to generate
- [x] 3.2 `src/commands/plan.ts` — browser launched once and closed in `finally`; per-route isolation (a failed route is reported, the rest continue); API-key check before launch, mirroring `run`
- [x] 3.3 `src/commands/plan.ts` — reporting (generated / already-covered / failed with reasons), preview-to-stdout by default, `--write` persists and prints created paths; exit codes 0/1/2 per spec
- [x] 3.4 `src/cli.ts` — register `plan` with `--base <ref>` (default `main`), `--url <url>`, `--route <route>` (repeatable), `--write`
- [x] 3.5 Unit tests for `planCommand` with mocked diff/impact/brain and a fake page: uncovered-route selection, `--route` bypass, preview writes nothing, `--write` creates files, partial failure exits 1, invalid base exits 2

## 4. E2E validation

- [x] 4.1 Against `examples/demo-app`: `plan --route <route>` produces a draft whose steps name real controls; `--write` persists it; `run` on the generated file passes with a real provider
- [x] 4.2 Diff-driven path: on a scratch branch, change a file mapped to a route with no covering test → `plan --base main` generates for exactly that route; verify the already-covered route is skipped
- [x] 4.3 `npm run build && npm run typecheck && npm test` all green

## 5. Docs

- [x] 5.1 README: document `plan`, its flags, the preview/`--write` model, the no-overwrite rule and the auth-walled-route limitation
- [x] 5.2 `AGENTS.md`: mark milestone M2 done (m2a + m2b) and add `plan` to the CLI entry line in the architecture block
