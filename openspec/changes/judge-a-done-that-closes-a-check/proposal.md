## Why

A step that acts and then verifies ("save the transaction by clicking "Add" and verify the first transaction has payee "Home Depot" …") can close on `done` right after the action. Its verification is never judged: the step passes on the acting model's own sentence about the page (#172).

`done` is accepted once something in the step succeeded (#76). A step that only verifies closes on a passing judgment and nothing else (#139), but that rule reads the step's first word, and `save … and verify …` starts with `save`.

Measured on 0.26.0, steps with a verification clause after an action:

| where | such steps | closed on `done`, unjudged |
| --- | --- | --- |
| reliability benchmark, `gpt-6-luna` | 35 | 5 (14%) |
| reliability benchmark, `claude-haiku-4.5` | 35 | 0 |
| a budgeting app's suite in CI, `claude-haiku-5.5` | 61 | 4 (7%) |

None of those sentences was wrong, so there is no false PASS on record. But the judge exists because the acting model's claims were wrong before (#31, #120, #147), and this path skips it on the most common step shape: the planner's rules ask every step to say what it should produce, with *"… and verify …"* as the example.

## What Changes

- When the model answers `done` on a step that contains a verification clause (`and verify …`, `then check …`, `, confirm …`), the executor does not close the step on it. It judges the step, as it would an `assert`, with the `done`'s reasoning as the claim, including the re-observation on a failed judgment.
- A passing judgment closes the step. A failing one is a failed attempt, and its reason goes back to the model, exactly as for a failed `assert`.
- No new model turn. The cost is one judge call, two on a failed first judgment, per step that closes this way today.

## Non-goals

- **A step that starts with a check verb** (#139). It keeps refusing `done`, as measured.
- **Judging every `done`.** A step that names only an action ("fill the note field with Check the invoice") has no outcome to judge. Judging it would fail the submit-and-redirect shape #44 describes.
- **Any language but English**, as for #139 and the authoring check.
- **A check in other words** ("… and the page shows X"). A verb list cannot see it.

## Capabilities

### New Capabilities

### Modified Capabilities

- `agentic-execution`: a `done` on a step with a verification clause is judged before it closes the step.

## Impact

- `src/runner/authoring.ts`: a predicate for a verification clause after the step's first word.
- `src/runner/executor.ts`: the `done` branch routes through the judgment the `assert` branch uses.
- Measured before merge: the dogfood notes test on Luna (5 of 5 unjudged before), the reliability benchmark on the reference pair, and the budgeting app's suite.
