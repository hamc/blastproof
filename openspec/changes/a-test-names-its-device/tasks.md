# Tasks: a-test-names-its-device

## 1. Naming a device

- [ ] 1.1 A shared device validator over Playwright's `devices`: registry check, suggestions by the given name's words, `defaultBrowserType` dropped from the options it returns; unit tests (design D1, D2)
- [ ] 1.2 `config.ts`: `browser.device`, and `BLASTPROOF_BROWSER_DEVICE` in `ENV_OVERRIDES`; tests for absent, valid, misspelled with suggestions, and an override naming the variable (spec device-emulation, config-overrides)
- [ ] 1.3 `testfile.ts`: `device`; tests for valid and misspelled, the error naming the file and the field (spec yaml-test-format)

## 2. Running as the device

- [ ] 2.1 `run.ts`: each test's context gets its device (test, else config), with and without the session; tests with a fake browser recording `newContext` options, including a desktop test beside a phone test and a session seeding a phone test (design D3, D4)
- [ ] 2.2 `auth.ts` and `plan.ts`: the login and the planner's contexts get `browser.device`; tests (design D4)
- [ ] 2.3 The run log's test header and the HTML report name the device; tests (design D5)

## 3. Dogfood

- [ ] 3.1 Demo app: a "Menu" button shown only under 600 px, opening the three links, the inline nav hidden at that width; the existing suite still passes on the desktop (design D6)
- [ ] 3.2 `.blastproof/tests/mobile-menu.yaml` with `device: "Pixel 7"`: open the menu, go to the cart; passes live, and fails with `device` removed
- [ ] 3.3 The demo app's reliability mutants still apply exactly once (`tests/reliability.test.ts`)

## 4. Documentation and wrap-up

- [ ] 4.1 `docs/configuration.md` (`browser.device`, the override, what is and is not emulated), the README's test format, `skills/blastproof/` test format, the CHANGELOG
- [ ] 4.2 `npm run build`, `npm run typecheck`, `npm test` pass
- [ ] 4.3 Archive in the same pull request, as its own commit
