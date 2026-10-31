# Tasks: carry-the-whole-session

## 1. Capture

- [x] 1.1 `fromSteps` captures with `indexedDB: true` (design D1)
- [x] 1.2 The falsy-key repair: read falsy keys and values from the login's last page, set them on Playwright's records; unit tests against Playwright's record shape (design D2)
- [x] 1.3 Session storage captured from the login's last page, with its origin (design D3)

## 2. Seeding and the second check

- [x] 2.1 `seedContext`: the init script writing session storage once per tab, behind the marker key; called after `newContext` in `run.ts` and `plan.ts`; tests (design D3)
- [x] 2.2 With `auth.verify`, the second judgment in a fresh seeded context on the login's last URL; an `AuthError` when it fails; tests for pass, fail and no `verify` (design D4)
- [x] 2.3 The cache keeps and restores session storage; a `storage_state` file without it reads as before (design D5)

## 3. Live

- [x] 3.1 The budgeting app's demo: a signed-in test checking the demo budget's accounts fails on `main` (it started on the start page; with a looser check, the agent created an empty budget and passed) and passes after the change; with IndexedDB capture disabled, the second check exits 2
- [x] 3.2 Juice Shop: a signed-in test that reads the basket sees it after the change
- [x] 3.3 The dogfood suite still passes with `auth.steps`

## 4. Documentation and wrap-up

- [x] 4.1 `docs/auth.md` (what is captured, the second check, the marker key), the CHANGELOG
- [x] 4.2 `npm run build`, `npm run typecheck`, `npm test` pass
- [x] 4.3 Archive in the same pull request, as its own commit
