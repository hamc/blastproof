# device-emulation Specification

## Purpose
Running a test as a given device, so the interface a responsive application shows on a phone can be tested beside its desktop interface.

## Requirements

### Requirement: A device is named from Playwright's registry
The configuration SHALL accept an optional `browser.device`, and a test file an optional `device`, each the name of a device in the installed Playwright's `devices` registry. A name not in the registry SHALL fail validation with an error naming the field and suggesting registry names that resemble it. Without either, a test's browser context SHALL be created exactly as before this capability existed.

#### Scenario: No device, no change
- **WHEN** neither the configuration nor a test names a device
- **THEN** the test runs at Playwright's default desktop viewport, as before

#### Scenario: Misspelled device
- **WHEN** `browser.device` is `"iphone"`
- **THEN** the CLI exits with a configuration error naming `browser.device` and suggesting iPhone names from the registry

### Requirement: A test runs as its device
A test's device SHALL be the test file's `device` when set, else `browser.device`. Its browser context SHALL be created with the device's viewport, screen, user agent, device scale factor, `isMobile` and `hasTouch`, in Chromium. A test's `device` SHALL apply to that test only.

#### Scenario: One suite, two devices
- **WHEN** `browser.device` is unset, one test sets `device: "Pixel 7"` and another sets none
- **THEN** the first runs at the Pixel 7's 412-pixel-wide viewport as a mobile device with touch, and the second at the desktop default, in the same run

#### Scenario: A test brought back to the desktop
- **WHEN** `browser.device` is `"Pixel 7"` and a test sets `device: "Desktop Chrome"`
- **THEN** that test runs as Desktop Chrome and the others as the Pixel 7

### Requirement: The login and the planner use the run's device
The login journey and `plan`'s page loads SHALL use `browser.device`. The session the login captures SHALL seed a test on any device, the test's own included.

#### Scenario: Session reused on a phone
- **WHEN** authentication is configured, `browser.device` is unset, and a test sets `device: "iPhone 15"`
- **THEN** the login runs once on the desktop, and the test starts on the iPhone 15 already signed in

### Requirement: The run says which device a test ran as
The run log's header line for a test, and the HTML report's entry for it, SHALL name the test's device when it has one.

#### Scenario: Device in the log
- **WHEN** a test runs as `Pixel 7`
- **THEN** its header line in the run log names `Pixel 7`
