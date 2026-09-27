# Spec delta: agentic-execution (label-a-redaction-with-its-variable)

## ADDED Requirements

### Requirement: A redaction names the variable it came from
The run-wide mask SHALL replace each registered value with a label naming the `{{env.*}}` variable it came from, `[redacted NAME]`, rather than one token shared by every secret. Occurrences of the same registered value SHALL receive the same label, and occurrences of different values SHALL receive different labels, so that whether two masked texts refer to the same value is preserved while the value is not.

A value registered without a variable name SHALL be replaced with `[redacted]`. The label SHALL contain the variable's name and nothing derived from the value: no length, no prefix, no hash.

#### Scenario: A true assertion on a secret passes on its merits
- **WHEN** `PROBE_SECRET=HUNTER2` is typed into the promo field, the page shows `Unknown promo code "HUNTER2".`, and a step verifies that the status reads `Unknown promo code "HUNTER2".`
- **THEN** the judge is shown `[redacted PROBE_SECRET]` in both the step and the page, and can match them

#### Scenario: A false assertion on another secret cannot pass by masking
- **WHEN** `OTHER_SECRET=SAVE99` is also registered, and a step verifies that the status reads `Unknown promo code "SAVE99".` while the page shows `Unknown promo code "HUNTER2".`
- **THEN** the judge is shown `[redacted OTHER_SECRET]` in the step and `[redacted PROBE_SECRET]` on the page, and the two do not match

#### Scenario: The value never appears
- **WHEN** any text containing a registered value is masked
- **THEN** the result contains the variable's name and no form of the value

### Requirement: A redaction label is not a typeable value
A `fill` or `select` action whose value contains a redaction label SHALL be refused, whatever else the value contains. The label is present on the page the model read, so the executor's source check alone would admit it; it is a mask artifact and never a value the application should receive.

The refusal SHALL tell the model that a label stands for a withheld value, and that a value from `{{env.*}}` is entered by the placeholder the step names.

#### Scenario: A copied label is not typed
- **WHEN** the model proposes to fill a field with `[redacted PROBE_SECRET]` copied from the snapshot
- **THEN** the action is refused before reaching the page, and the refusal explains why

#### Scenario: The placeholder still works
- **WHEN** the step names `{{env.PROBE_SECRET}}` and the model fills the field with `{{env.PROBE_SECRET}}`
- **THEN** the action is admitted and the real value is typed, as before

## MODIFIED Requirements

### Requirement: A redacted value is described to the model, not left ambiguous
Where the run-wide mask has replaced a value crossing into a prompt, the model SHALL be told what a redaction is: that `[redacted NAME]` stands for the value of `{{env.NAME}}`, deliberately withheld; that the same label means the same value and different labels mean different values; that seeing one is expected; and that a field showing a redaction after being filled from an `{{env.*}}` placeholder is consistent with the fill having succeeded. A judgment SHALL NOT fail an expectation on the grounds that a value was redacted, and SHALL treat two different labels as two different values.

The model SHALL also be told never to type a label as a value.

This requirement adds context only. The mask itself remains the boundary: every referenced secret is still redacted from every prompt input.

#### Scenario: A filled credential field is not treated as unverifiable
- **WHEN** a step fills a field from an `{{env.*}}` placeholder and the resulting snapshot shows a redaction where the value would be
- **THEN** the model treats the fill as having succeeded rather than retrying it, and the step advances

#### Scenario: A redaction is not grounds for failing
- **WHEN** an expectation would otherwise be satisfied except that a value in the snapshot is redacted
- **THEN** the judgment does not fail on that basis

#### Scenario: The boundary is unchanged
- **WHEN** any value the run has registered as secret crosses into a prompt
- **THEN** it is still redacted, exactly as before

### Requirement: The mask compares by normalization, not by byte equality
The run-wide mask SHALL redact any occurrence of a registered value that matches it **case-insensitively, with runs of whitespace matched as runs of whitespace** — the same normalization this specification already applies when deciding whether a typed value came from the application. The literal and percent-encoded forms SHALL keep being redacted, so nothing masked today stops being masked.

No further normalization SHALL be applied, and no catalogue of application-side transforms SHALL be maintained. A value the application re-encodes, hashes or truncates produces a string this comparison cannot recognise, and that limit is stated rather than papered over.

The comparison SHALL be a property of the mask itself, so every channel it already covers — the snapshot, the action record, the last result, the step text, the failure reason, the reports — gains it at once, rather than being widened at one call site.

#### Scenario: A value the page uppercased is still redacted
- **WHEN** a test fills a field from `{{env.PROBE_SECRET}}` whose value is `hunter2`, and the application echoes `Unknown promo code "HUNTER2".`
- **THEN** the snapshot crossing into the prompt reads `Unknown promo code "[redacted PROBE_SECRET]".`

#### Scenario: Spacing differences do not defeat it
- **WHEN** a registered value contains a space and the page renders it with different whitespace between the same words
- **THEN** the occurrence is redacted

#### Scenario: Every previously masked form stays masked
- **WHEN** a value appears byte-identically, or percent-encoded in a resolved URL
- **THEN** it is redacted exactly as before

#### Scenario: An unrecognisable transform is not claimed
- **WHEN** the application renders a registered value base64-encoded or hashed
- **THEN** the mask does not redact it, and the documentation says this is the boundary
