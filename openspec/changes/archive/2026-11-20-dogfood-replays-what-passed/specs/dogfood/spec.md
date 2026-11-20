## ADDED Requirements

### Requirement: The scheduled self-test runs the suite cold and then warm
The Dogfood workflow SHALL run the demo app's suite twice in one job, with replay on both times, from a checkout with nothing saved. Before the second run, it SHALL restart the demo app, so that server-held state from the first run is gone. Each run SHALL fail the job when its score is below the workflow's minimum. The second run SHALL NOT start when the first one failed.

The workflow SHALL NOT restore saved replay files from an earlier workflow run.

#### Scenario: The first run asks the model for every step
- **WHEN** the scheduled job starts
- **THEN** the first run finds nothing saved, and no step of it is replayed

#### Scenario: The second run sees no state from the first
- **WHEN** the first run added a note on the demo app
- **THEN** the second run's notes page shows no note before its notes test adds one

### Requirement: The second run fails when replay did not work
The second run SHALL fail the job when fewer than half of its steps covered by the replay counters were replayed, `replayed_steps / (replayed_steps + model_steps) < 0.5`, read from its JUnit report. Missing counters SHALL count as no step replayed. The failure SHALL name both counts.

The job summary SHALL show both runs' counts of replayed, model-resolved and healed steps.

#### Scenario: A replay that stopped working fails the job
- **WHEN** the second run scores 100 with every step resolved by the model
- **THEN** the job fails and names 0 steps replayed

#### Scenario: One step resolved by the model does not fail the job
- **WHEN** the second run replayed 39 steps and resolved 1 with the model
- **THEN** the replay check passes
