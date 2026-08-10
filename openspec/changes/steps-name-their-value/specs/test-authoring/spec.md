# Spec delta: test-authoring (steps-name-their-value)

## ADDED Requirements

### Requirement: Detect a value-entering step that names no value

The system SHALL detect, over the `steps` and `setup` of every parsed test file, any **English** step that names a value-entering action while supplying no source for the value. Detection SHALL be deterministic and SHALL require no browser, model, network or API key. Detection SHALL NOT reject, rewrite or reorder a test file, and SHALL NOT alter test selection.

Detection is defined over English grammar only. A step written in another language SHALL produce no finding, and the absence of a finding SHALL NOT be represented anywhere as evidence that a suite was checked.

A step names a value-entering action when it contains one of the closed verb set `fill`, `enter`, `type`, `input`, `set`, matched case-insensitively on word boundaries.

A step supplies a value when it contains a connector: `with`, `to`, `as`, `using`, `into`, `from`, `in`, `:`, `=`, a quotation mark, or an `{{env.` placeholder. A step containing any connector SHALL NOT be reported. The connector `in` SHALL count only when it is not adjacent to the value-entering verb, so that the phrasal verbs `fill in` and `type in` do not silence the check.

#### Scenario: A fill step with no value is reported
- **WHEN** a test declares the step `fill the note field`
- **THEN** the step is reported, naming the test, the step's position and its text

#### Scenario: A step naming its value is not reported
- **WHEN** a test declares the step `fill the note field with Order not received`
- **THEN** the step is not reported

#### Scenario: A step taking its value from an env placeholder is not reported
- **WHEN** a test declares the step `fill password with {{env.TEST_PASSWORD}}`
- **THEN** the step is not reported

#### Scenario: A step taking its value from the page is not reported
- **WHEN** a test declares the step `fill the recipient field with the address shown on the confirmation page`
- **THEN** the step is not reported, because the executor is permitted to take a value from the page

#### Scenario: A quoted value is not reported
- **WHEN** a test declares the step `enter "Order not received" in the note field`
- **THEN** the step is not reported

#### Scenario: A value introduced by a connector other than `with` is not reported
- **WHEN** a test declares the step `set the priority to High`
- **THEN** the step is not reported, because `to` introduces the value

#### Scenario: A value preceding its field is not reported
- **WHEN** a test declares the step `enter Order not received in the subject field`
- **THEN** the step is not reported, because `in` is not adjacent to the verb and introduces the field the value goes into

#### Scenario: A phrasal verb does not silence the check
- **WHEN** a test declares the step `fill in the note field`
- **THEN** the step is reported, because the `in` belongs to the verb rather than introducing a value

#### Scenario: setup steps are checked too
- **WHEN** a test declares `setup: ["fill the search box"]` and no offending entry under `steps`
- **THEN** the setup step is reported, because setup steps run through the same executor

#### Scenario: The verb match is word-bounded
- **WHEN** a test declares the step `setup the account and verify the dashboard is shown`
- **THEN** the step is not reported, because `setup` is not the verb `set`

#### Scenario: A non-English step produces no finding
- **WHEN** a test declares the step `preencha o campo de observação`, which names no value
- **THEN** no finding is produced, because detection is defined over English grammar only

#### Scenario: A step with no value-entering verb is not reported
- **WHEN** a test declares the step `click Save and verify the confirmation is shown`
- **THEN** the step is not reported, because it enters no value

#### Scenario: Findings are reported in file and step order
- **WHEN** several tests each declare more than one offending step
- **THEN** findings are returned grouped by test in input order, and within a test in step order, so output is stable across runs

### Requirement: The authoring rule has one wording across every place it is stated

The rule that a step entering a value must name the value SHALL be stated identically in substance wherever it appears — the planner system prompt, the README's test-authoring guidance, and the authoring check's own message — and a test SHALL fail when they diverge.

#### Scenario: Divergence fails the suite
- **WHEN** the rule's wording is changed in the planner prompt but not in the README or the check's message
- **THEN** a test fails, naming the places that disagree
