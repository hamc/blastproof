## MODIFIED Requirements

### Requirement: Every sample is scored as one outcome
A mutant sample SHALL be scored as caught (FAIL at the declared step, or at the step before it when the runner judges that step on the declared one), caught elsewhere (FAIL at another step), false PASS, or incomplete. An unmodified-suite sample SHALL be scored as PASS, false FAIL, or incomplete. The verdict and failing step SHALL be read from the run's JUnit report. A run whose sign-in failed SHALL score every test of the unmodified suite as a false FAIL, and a mutant sample as caught elsewhere. Only a run stopped by its budget or its provider SHALL be incomplete. Incomplete samples SHALL be counted and excluded from every rate.

#### Scenario: Failing at another step
- **WHEN** a mutant's target test fails at a step other than the declared one
- **THEN** the sample is caught elsewhere, not caught, and it is reported on its own line

#### Scenario: Failing at the step judged on the declared one
- **WHEN** a mutant's declared step is a check that directly follows an action step in the same list, and the target test fails at that action step
- **THEN** the sample is caught, because that action step was judged on the declared check

#### Scenario: Sign-in fails on the correct app
- **WHEN** a run of the unmodified suite exits 2 because its sign-in failed
- **THEN** every test of that run is a false FAIL, not incomplete

#### Scenario: A provider refusal
- **WHEN** a sample's run ends incomplete
- **THEN** it is counted as incomplete and appears in no rate
