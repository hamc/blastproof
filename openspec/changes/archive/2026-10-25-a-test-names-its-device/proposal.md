## Why

Every test runs in Chromium at Playwright's default 1280×720 desktop viewport, and nothing in the config or a test file changes it (#163). A responsive application renders a different interface on a phone (a bottom tab bar instead of a sidebar, full-screen pages instead of dialogs), and that interface cannot be tested. On one real application's own e2e suite, 37 of about 130 tests are mobile, the largest block of it out of blastproof's reach.

## What Changes

- `browser.device` in the config names a device from Playwright's registry (`"Pixel 7"`, `"iPhone 15"`, `"Desktop Chrome"`), and every test's browser context is created with it: viewport, user agent, device scale, `isMobile` and `hasTouch` together. Absent, nothing changes.
- A test file's `device:` overrides it for that test, so desktop and mobile journeys sit in one suite and one run.
- A name not in the registry fails validation, in the config or the test file, naming the field and the closest names.
- `BLASTPROOF_BROWSER_DEVICE` overrides `browser.device` from the environment, so a CI matrix can run one suite on a desktop and a phone.
- The login journey runs on `browser.device`, and the session it captures seeds every test whatever its device.
- A test run on a device says so in the run log and the HTML report.
- The demo app gets a menu that only a phone-width page shows, and the dogfood suite a test that uses it.

## Non-goals

- **A touch action.** On a device with touch, `click` is still a mouse click, which mobile pages accept. Whether the model should `tap` is #22's question about the action vocabulary.
- **Free width and height** without a device. A device name is one setting Playwright users know; explicit fields can follow if someone needs a size no device has.
- **Other browsers.** An iPhone is emulated in Chromium, as every test is. That is the viewport and the user agent of an iPhone, not Safari's engine.

## Capabilities

### New Capabilities

- `device-emulation`: naming a device in the config and in a test, how it is validated, what the run applies and reports, and which device the login and `plan` use.

### Modified Capabilities

- `yaml-test-format`: the optional `device` field.
- `config-overrides`: `BLASTPROOF_BROWSER_DEVICE`.

## Impact

- `src/config.ts`: `browser.device`, validated against Playwright's `devices`, and its override.
- `src/runner/testfile.ts`: `device`, validated the same way.
- `src/commands/run.ts`, `src/commands/plan.ts`, `src/auth.ts`: the context options carry the device.
- `src/report/html.ts`: the test's device.
- `examples/demo-app/`, `.blastproof/tests/`: a phone-only menu and its test.
- No new dependency: the registry is Playwright's `devices`.
- Documentation: `docs/configuration.md`, the README's test format, the agent skill's test format, the CHANGELOG.
