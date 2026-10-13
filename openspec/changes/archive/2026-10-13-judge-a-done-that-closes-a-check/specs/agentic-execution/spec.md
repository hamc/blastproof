## ADDED Requirements

### Requirement: A done on a step that asks for a check is judged

When the model answers `done` on a step whose text contains a verification clause after its first clause (a check verb introduced by `and`, `then`, a comma or a semicolon), the executor SHALL NOT close the step on the `done`. It SHALL judge the step with the `done`'s reasoning as the claim, by the same procedure as an `assert`, re-observation on a failed judgment included. A passing judgment SHALL close the step. A failing one SHALL count as one failed attempt, with the judge's reason returned to the model.

A step whose text contains no such clause SHALL close on `done` as before, and a step that starts with a check verb SHALL keep refusing `done`.

#### Scenario: An act-and-verify step closed on done is judged
- **WHEN** a step says "save the transaction by clicking "Add" and verify the first transaction has payee "Home Depot"", the click succeeds, and the model answers `done` saying the first row shows Home Depot
- **THEN** the step is judged against the page with that sentence as the claim, and closes only if the judgment passes

#### Scenario: A failing judgment of a done is a failed attempt
- **WHEN** the judgment of such a `done` fails on the re-observed page as well
- **THEN** the step does not close, one failed attempt is counted, and the judge's reason is the model's next result

#### Scenario: A step that names only an action closes as before
- **WHEN** a step says "fill the note field with Check the invoice", the fill succeeds, and the model answers `done`
- **THEN** the step closes without a judgment

#### Scenario: A step that only verifies still refuses done
- **WHEN** a step begins with "verify" and the model answers `done`
- **THEN** the `done` is refused as before
