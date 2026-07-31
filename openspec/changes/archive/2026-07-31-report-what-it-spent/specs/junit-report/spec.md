## MODIFIED Requirements

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
