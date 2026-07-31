## ADDED Requirements

### Requirement: Tests may run concurrently
`run` SHALL support executing several tests at once, bounded by a configured maximum. The maximum SHALL be configurable in `.blastproof/config.yaml` as `concurrency:` and overridable per invocation with `--concurrency <n>`, the flag taking precedence over the file. A value below 1 SHALL be rejected with an explanatory error rather than clamped.

The default SHALL be 1. Tests are journeys driven against one running application, and whether two of them can run at the same time is a property of the application and the tests, not of the runner — so concurrency is opted into by the person who knows, never assumed on their behalf.

Results SHALL be reported in selection order on every surface, regardless of the order in which tests finish.

#### Scenario: Concurrency is opted into
- **WHEN** no `concurrency:` is configured and no flag is given
- **THEN** tests run one at a time, as they do today

#### Scenario: Several tests at once
- **WHEN** `concurrency: 4` is configured and more than four tests are selected
- **THEN** at most four run at the same time, and the rest start as earlier ones finish

#### Scenario: The flag beats the file
- **WHEN** the config declares a concurrency and `--concurrency` is given
- **THEN** the flag's value is used

#### Scenario: An invalid concurrency is refused
- **WHEN** a concurrency below 1 is configured or passed
- **THEN** the run fails with an explanatory error instead of silently choosing a value

#### Scenario: Report order does not depend on timing
- **WHEN** tests finish in a different order from the one they were selected in
- **THEN** the summary and every written report list them in selection order

### Requirement: Concurrent output stays readable
When more than one test can be in flight, each test's console output SHALL be presented as one contiguous block, printed when that test finishes, so that a step transcript can be read consecutively. When tests run one at a time, output SHALL stream as each event occurs, unchanged.

#### Scenario: Blocks, not interleaving
- **WHEN** several tests run at once
- **THEN** each test's header, steps and result appear together, not interleaved with another test's

#### Scenario: Live output is preserved when serial
- **WHEN** tests run one at a time
- **THEN** events print as they happen, exactly as before
