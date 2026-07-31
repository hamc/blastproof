## ADDED Requirements

### Requirement: A run reports what it spent
A run SHALL report the model calls and tokens it actually spent, for a completed run and for one stopped by its own budget or deadline alike. Where a limit is configured, the report SHALL name the spend against that limit; where none is, it SHALL report the figure alone.

The token figure SHALL distinguish "no tokens were reported" from "no tokens were spent". Where no completed call reported usage, the report SHALL say the figure is unavailable rather than showing zero; where only some calls reported it, the report SHALL say how many calls the figure covers.

The spend SHALL be reported once per budget. The command that constructed the budget is the one that reports it, so a composed run sharing one allowance across phases reports one total rather than one per phase.

#### Scenario: A completed run reports its spend
- **WHEN** a run finishes
- **THEN** the summary states the model calls and the tokens it spent

#### Scenario: An interrupted run reports its spend too
- **WHEN** a run is stopped by its budget or deadline
- **THEN** the summary states what was spent as well as which limit stopped it

#### Scenario: Reported against a configured limit
- **WHEN** a maximum number of calls is configured
- **THEN** the spend is reported against that maximum

#### Scenario: A provider that reports no usage
- **WHEN** no completed call reported token usage
- **THEN** the token figure is reported as unavailable, not as zero

#### Scenario: Only some calls reported usage
- **WHEN** some completed calls reported token usage and others did not
- **THEN** the reported total says how many calls it covers

#### Scenario: One allowance, one report
- **WHEN** one budget is shared across the phases of a composed run
- **THEN** the spend is reported once, by the command that created the budget
