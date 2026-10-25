## ADDED Requirements

### Requirement: Environment override for the device
The system SHALL override `browser.device` from `BLASTPROOF_BROWSER_DEVICE`, validated as the file value is. A test file's own `device` SHALL still win over it.

#### Scenario: One suite on a phone, for one run
- **WHEN** the config file names no device and `BLASTPROOF_BROWSER_DEVICE="Pixel 7"` is set
- **THEN** every test without its own `device` runs as the Pixel 7, and the config file is not modified

#### Scenario: Unknown device from the environment
- **WHEN** `BLASTPROOF_BROWSER_DEVICE=phone` is set
- **THEN** the CLI exits with a configuration error naming `BLASTPROOF_BROWSER_DEVICE`
