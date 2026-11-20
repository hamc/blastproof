## ADDED Requirements

### Requirement: Environment override for replay
The system SHALL read `replay` (a boolean, default `false`) from `.blastproof/config.yaml` and SHALL override it from `BLASTPROOF_REPLAY`, validated as the file value is.

#### Scenario: Turned on for one run
- **WHEN** the config file has no `replay` key and `BLASTPROOF_REPLAY=true` is set
- **THEN** the run replays saved steps and saves the passing ones, and the config file is not modified

#### Scenario: Invalid value
- **WHEN** `BLASTPROOF_REPLAY=sometimes` is set
- **THEN** the CLI exits with a configuration error naming `BLASTPROOF_REPLAY`
