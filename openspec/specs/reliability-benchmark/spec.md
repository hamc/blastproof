# reliability-benchmark Specification

## Purpose
TBD - created by archiving change measure-verdict-reliability. Update Purpose after archive.

## Requirements

### Requirement: The benchmark runs the suite on the correct app and its mutants
`npm run eval:reliability` SHALL run every dogfood test against an unmodified copy of `examples/demo-app`, and each mutant's target test against a copy with that mutant's edits applied, `EVAL_SAMPLES` times (default 5) on each model in `EVAL_MODELS`. Each sample SHALL use the built CLI against its own server on its own copy.

#### Scenario: A mutant sample
- **WHEN** a sample of mutant `discount-10pct` runs on a model
- **THEN** a fresh copy of the demo app with that mutant's edits is served on its own port, and only the cart-discount test runs against it

#### Scenario: State does not leak between samples
- **WHEN** two samples of the notes test run one after the other
- **THEN** each starts from a server with no notes on file

### Requirement: A mutant applies exactly or the benchmark stops
Each edit's `find` text SHALL occur exactly once in its file. Otherwise the benchmark SHALL exit non-zero, naming the mutant and the file, before any model call.

#### Scenario: The app changed under a mutant
- **WHEN** an edit's `find` text no longer occurs in its file
- **THEN** the benchmark exits 1 naming that mutant, and no model is called

### Requirement: Every sample is scored as one outcome
A mutant sample SHALL be scored as caught (FAIL at the declared step), caught elsewhere (FAIL at another step), false PASS, or incomplete. An unmodified-suite sample SHALL be scored as PASS, false FAIL, or incomplete. The verdict and failing step SHALL be read from the run's JUnit report. A run whose sign-in failed SHALL score every test of the unmodified suite as a false FAIL, and a mutant sample as caught elsewhere. Only a run stopped by its budget or its provider SHALL be incomplete. Incomplete samples SHALL be counted and excluded from every rate.

#### Scenario: Failing at another step
- **WHEN** a mutant's target test fails at a step other than the declared one
- **THEN** the sample is caught elsewhere, not caught, and it is reported on its own line

#### Scenario: Sign-in fails on the correct app
- **WHEN** a run of the unmodified suite exits 2 because its sign-in failed
- **THEN** every test of that run is a false FAIL, not incomplete

#### Scenario: A provider refusal
- **WHEN** a sample's run ends incomplete
- **THEN** it is counted as incomplete and appears in no rate

### Requirement: Rates come with their uncertainty
The report SHALL give, per model and per mutant class, the false PASS rate and, per model, the false FAIL rate, each with its sample count and a 95% Wilson upper bound.

#### Scenario: No false PASS observed
- **WHEN** 60 subtle-mutant samples on a model are all caught
- **THEN** the report shows 0/60 with an upper bound near 6%, not a bare 0%

### Requirement: Subtle mutants name their incident
A mutant of class `subtle` SHALL name the incident whose shape it reproduces, and the benchmark SHALL refuse a `subtle` mutant without one.

#### Scenario: A subtle mutant without an incident
- **WHEN** `mutants.json` holds a `subtle` mutant with no `incident`
- **THEN** the benchmark exits 1 naming it, before any model call
