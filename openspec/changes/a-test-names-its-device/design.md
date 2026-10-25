## Context

Each test gets a fresh browser context in `runOne` (`browser.newContext(contextOptions(session))` when it uses the session, `{}` when it does not). `plan` creates one per route the same way, and the login journey (`auth.ts`, `fromSteps`) creates its own. None of them pass viewport or device options, so every page is Playwright's 1280×720 desktop.

## Goals / Non-Goals

**Goals:**

- A suite can hold desktop and phone journeys and run them together.
- A misspelled device fails before any browser starts, like any other config error.

**Non-Goals:**

- A touch action, free viewport sizes, other browser engines (proposal).

## Decisions

### D1. A Playwright device name, not explicit fields

`browser.device: "Pixel 7"` reads `devices["Pixel 7"]` from `playwright`. One name sets the viewport, the screen, the user agent, the device scale factor, `isMobile` and `hasTouch` together. Those are the six things a responsive app reacts to, and getting one of them wrong (a phone width with a desktop user agent) tests an interface no user sees.

The descriptor's `defaultBrowserType` is dropped before it reaches `newContext`: every test runs in Chromium (proposal non-goal), and the field is not a context option.

Alternative rejected: `viewport: { width, height }` with `is_mobile` and `has_touch`. More to write, and four ways to describe a device no user has. It can be added later for a size no device covers.

### D2. Validated against the registry, at load time

Both schemas refine the string with `name in devices`. The message names the field and the last three registry names that contain the given one's words, case-insensitively, which are the newest it lists (`"iphone"` → `iPhone 17 Pro, iPhone 17 Pro Max, iPhone 17e`), or says to see Playwright's list. A broken test file is already a failed test rather than a stopped run, and an unknown device in one is no different. The registry ships with the installed Playwright, so a device added in a later Playwright is valid as soon as it is installed.

### D3. A test's `device` wins over the config's

`device` in a test file is resolved per test: the test's, else `browser.device`, else none. "None" is the context exactly as today, so a config without `device` and tests without it run unchanged. A suite set to a phone can bring one test back to the desktop with `device: "Desktop Chrome"`, which is in the registry; no special value is needed.

### D4. The login runs on the run's device; its session seeds every test

The login journey uses `browser.device`, because an app whose login page differs on a phone is logged into the way its tests will use it. A captured session is cookies and storage, which do not depend on the viewport, so it seeds a test on any device. The verification after the login is one judgment on that page, the same on any device.

`plan` drafts every route on `browser.device`, since it has no test file to read one from.

### D5. What the run says

The test's header line in the run log adds the device when it has one: `> Opens the menu on a phone [P1] [Pixel 7] (...)`. The HTML report shows it beside the priority. JUnit is unchanged: it has no field for it, and a property nobody reads is noise.

### D6. Dogfood: a menu only a phone shows

The demo app's header gets a "Menu" button that a CSS media query shows only under 600 px, opening the same three links, while the inline nav is hidden at that width. A test with `device: "Pixel 7"` opens the menu and goes to the cart. On a desktop the button is not rendered, so the test checks what it claims: it cannot pass on the desktop interface.

## Risks / Trade-offs

- [An iPhone in Chromium is not Safari] → the docs say what is emulated and what is not.
- [A page wider than the phone] → the snapshot is the accessibility tree, which does not depend on what is on screen; a click on an element off screen scrolls to it, as on the desktop.
- [Registry names change between Playwright versions] → validation at load time turns that into an error naming the field, not a silent desktop run.
