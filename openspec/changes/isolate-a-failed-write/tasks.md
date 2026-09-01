# Tasks: isolate-a-failed-write

## 1. Contain the write branch

- [x] 1.1 `src/commands/plan.ts` — the write branch records the route as failed and continues for any error, matching the generation branch above it (design D1)
- [x] 1.2 The failed route is not counted as generated (design D2)

## 2. Tests

- [x] 2.1 `tests/plan.test.ts` — three routes with `--write`, the second colliding with an existing file: the third is still written, the summary names the second, exit code is 1
- [x] 2.2 `tests/plan.test.ts` — `writeDraft` throws an error the command does not recognise: the route is reported and the remaining route is still attempted (design D3)
- [x] 2.3 Mutation: restored `throw error` in the write branch — 2.2 fails, 2.1 and the other 18 pass. That is the predicted result: `writeDraft` wraps the collision itself, so only the kind-independent test protects the loop

## 3. Verification

- [x] 3.1 `npm run build`
- [x] 3.2 `npm run typecheck`
- [x] 3.3 `npm test` — 564 passed, 33 files
