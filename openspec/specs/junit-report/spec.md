# junit-report Specification

## Purpose

Emit the run as JUnit XML, the format CI systems already know how to render, so results and score are machine-readable without scraping console output.
## Requirements
### Requirement: JUnit XML structure
The system SHALL emit a single `testsuite` element for the run, carrying `tests`, `failures`, `skipped` and total `time` attributes, containing one `testcase` per test with `classname` set to the repo-relative test file path, `name` set to the test summary, and `time` in seconds.

#### Scenario: Passing test emitted as a bare case
- **WHEN** a test passes
- **THEN** its `testcase` element has no `failure` or `skipped` child

#### Scenario: Suite counts match its cases
- **WHEN** a run produces two passing tests, one failure and one skipped test
- **THEN** the suite attributes report 3 tests, 1 failure and 1 skipped

### Requirement: Failures carry the reason and failing step
A failed test SHALL be emitted with a `failure` child whose `message` attribute is the failure reason and whose body names the failing step.

#### Scenario: Failure detail present
- **WHEN** a test fails on the step "apply promo code SAVE20" because the element was not found
- **THEN** its `failure` element carries the reason in `message` and names that step in its body

### Requirement: Unrouted tests emitted as skipped
Tests skipped as unrouted under `--impacted` SHALL appear in the XML as `testcase` elements with a `skipped` child, so the coverage gap is visible in CI rather than absent.

#### Scenario: Skipped case present
- **WHEN** `--impacted` skips a test that declares no `routes:`
- **THEN** the XML contains a `testcase` for it with a `skipped` child

### Requirement: Score exposed as a property
The XML SHALL expose the run score as a `property` named `score`, so a CI parser can read it without scraping console output.

The XML SHALL likewise expose what the run spent: a property named `llm_calls`, and a property named `llm_tokens` when any completed call reported token usage. Both SHALL carry the same figures the summary states, taken from the same source, so the report and the console cannot disagree.

#### Scenario: Score readable from the report
- **WHEN** a run scores 75 and writes a JUnit report
- **THEN** the XML contains a property named `score` with value 75

#### Scenario: Spend readable from the report
- **WHEN** a run spends model calls and writes a JUnit report
- **THEN** the XML contains a property named `llm_calls` carrying the number of calls made

#### Scenario: No token usage to expose
- **WHEN** no completed call reported token usage
- **THEN** no `llm_tokens` property is emitted, rather than one carrying zero

### Requirement: XML escaping
All interpolated text SHALL be XML-escaped, covering `&`, `<`, `>`, `"` and `'`, so that user- and model-authored summaries, steps and failure reasons cannot produce invalid XML.

#### Scenario: Special characters preserved safely
- **WHEN** a test summary contains `Cart & "checkout" <flow>`
- **THEN** the emitted XML is well-formed and the escaped text round-trips to the original string

### Requirement: Report destination
The `run` command SHALL write the JUnit report only when asked: to an explicitly given path when one is provided, otherwise to `junit.xml` inside the run's report session directory. Missing parent directories SHALL be created.

#### Scenario: Default destination
- **WHEN** the user requests a JUnit report without naming a path
- **THEN** the file is written as `junit.xml` inside `.blastproof/reports/<session>/`

#### Scenario: Explicit destination
- **WHEN** the user requests a JUnit report at `build/reports/e2e.xml` and `build/reports/` does not exist
- **THEN** the directory is created and the file is written there

#### Scenario: Not requested
- **WHEN** the user runs without requesting a JUnit report
- **THEN** no JUnit file is written

