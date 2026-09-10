# Tasks: skip-a-login-nothing-selected-needs

## 1. The predicate

- [ ] 1.1 `run` authenticates only when some selected test wants the session (design D1), using the `selected` set already in scope
- [ ] 1.2 It applies to every strategy, not only `auth.steps` (design D2)
- [ ] 1.3 Nothing is printed when the login is skipped (design D5)

## 2. The ceiling

- [ ] 2.1 `printDryRun` charges for the login journey under the same predicate, from the same `selected` (design D3)
- [ ] 2.2 A test asserts the two agree: the ceiling for an `auth: false`-only selection equals the ceiling computed without the login

## 3. Tests

- [ ] 3.1 #102's reproduction: a selection of only `auth: false` tests performs no login — `authenticate` is not called
- [ ] 3.2 One authenticated test in the selection is enough: the login runs (`some`, not `every`)
- [ ] 3.3 A suite that never declares `auth:` is unaffected, because `auth` defaults to `true`
- [ ] 3.4 **The exit 2 goes away**: `auth.storage_state` naming a missing file, with a selection of only `auth: false` tests, exits as it would have without `auth:` configured — and still exits 2 when a selected test wants the session
- [ ] 3.5 The budget path: a run that would have exhausted during the login no longer reports `incomplete` when nothing selected needed it
- [ ] 3.6 `auth.verify` does not run when the login is skipped
- [ ] 3.7 The dry-run ceiling drops for an `auth: false`-only selection, and is unchanged for a selection containing an authenticated test
- [ ] 3.8 `plan` still authenticates unconditionally (design D4) — pinned, so this change cannot leak into it
- [ ] 3.9 Mutation: change `some` to `every`; drop the ceiling's half of the predicate; revert the run's half. Record which tests go red for each, and that nothing outside the new block moves

## 4. Verification

- [ ] 4.1 `npm run build`, `npm run typecheck`, `npm test`
- [ ] 4.2 Live, no key needed: `run --tag consent --dry-run` on this repository reports a ceiling with the login journey removed, and the line no longer says "including the login journey"
- [ ] 4.3 Live, agentic, against `examples/demo-app`: a selection of only `auth: false` tests runs without `Authenticating...`, and a selection containing an authenticated test still logs in once. This one is worth the model calls — the claim is about what a real run does or does not do
- [ ] 4.4 Measure the saving rather than assert it: model calls for the `auth: false`-only selection, before and after

## 5. Documentation

- [ ] 5.1 README: `auth:` says when the login runs, not only that it runs once per run
- [ ] 5.2 `skills/blastproof/references/authoring.md`: `auth: false` now also means the run may skip the login entirely, which is worth knowing when writing a signed-out test
