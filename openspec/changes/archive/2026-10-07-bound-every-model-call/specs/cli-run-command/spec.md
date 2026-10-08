# Spec delta: cli-run-command (bound-every-model-call)

## ADDED Requirements

### Requirement: A termination signal ends the process
SIGTERM SHALL end the process with exit code 143, and SIGHUP with 129, closing the browser, whatever the run is waiting on. No report is written.

#### Scenario: A cancelled CI job
- **WHEN** a run waiting on a model call receives SIGTERM
- **THEN** the process exits with code 143 within seconds, and no browser process is left running
