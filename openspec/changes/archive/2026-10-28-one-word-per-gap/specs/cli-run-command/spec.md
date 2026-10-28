## ADDED Requirements

### Requirement: Impact report layout
The `--impacted` report SHALL name the base ref it compared against, and SHALL open with one line stating what is not covered: the number of unclassified changed files, of routes the diff reaches that no selected test covers, and of tests that declare no `routes:`, or that nothing is uncovered. It SHALL then report changed files, the routes they reach and the tests, in that order, each subject once, with its gap marked where the subject is listed. Ignored files SHALL be counted and the first three named.

#### Scenario: The opening line counts the gaps
- **WHEN** the diff has one unclassified file, reaches one route no selected test covers, and the suite has one test with no `routes:`
- **THEN** the report's first line after its header counts one of each

#### Scenario: Nothing uncovered
- **WHEN** every changed file is classified, every route reached has a selected test, and every test declares `routes:`
- **THEN** the opening line says nothing is uncovered

#### Scenario: A route is listed once
- **WHEN** the diff reaches `/checkout` and no selected test covers it
- **THEN** `/checkout` appears once in the report, marked as covered by no selected test

#### Scenario: Ignored files are named
- **WHEN** an `ignore:` glob matches five changed files
- **THEN** the report counts five, names the first three, and says two more

## MODIFIED Requirements

### Requirement: Unrouted tests under --impacted
Tests that declare no `routes:` SHALL NOT be executed by `--impacted`; they SHALL be reported as declaring no `routes:`, so the user can add coverage declarations.

#### Scenario: Unrouted test skipped and reported
- **WHEN** `--impacted` runs and a test has no `routes:` field
- **THEN** the test is not executed and is listed under the tests as declaring no `routes:`

### Requirement: Uncovered route reporting
When no executed test covers a route the diff reaches, the CLI SHALL report that route as covered by no selected test and exit with code 0.

#### Scenario: No impacted tests
- **WHEN** the diff reaches `/settings` and no test covers `/settings`
- **THEN** the output lists `/settings` as covered by no selected test, no tests execute, and the exit code is 0

### Requirement: Dry run
The `run` command SHALL support `--dry-run`, printing the impacted selection (the impact report, the selected tests) and the worst-case model-call count for that selection, without launching a browser or calling the LLM, exiting with code 0.

#### Scenario: Dry run output
- **WHEN** the user runs `blastproof run --impacted --dry-run`
- **THEN** the console shows the impact report and the tests that would run, and no browser is launched

#### Scenario: Dry run reports the ceiling
- **WHEN** a dry run reports its selection
- **THEN** it also reports the maximum number of model calls that selection could make
