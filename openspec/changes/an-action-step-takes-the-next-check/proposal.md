## Why

A step that names an action and stops, followed by a step that checks its result, fails on a correct application when the action erases its own evidence (#44). Measured on this repository's notes page, which redirects back to an empty form after a submit, with the same test written two ways and 10 runs each on 0.32.0:

| Wording | Haiku | Luna |
| --- | --- | --- |
| `submit the add-note form`, then `verify the note "Check the invoice" appears in the notes list` | 0/10 | 6/10 |
| `submit the add-note form and verify the note "Check the invoice" appears in the notes list` | 10/10 | 10/10 |

The application was correct in all 40 runs. In the split form the model clicks "Add note", sees an empty form, and sets out to prove "the form was submitted": it asserts that and the judge fails it, it tries to type the note again and is refused, or it fails the step for want of a value. It does not know what the submit was meant to produce, because the step does not say, and the next step, which does, is not in its prompt.

#44 proposed a warning that tells the author to merge the two steps. A warning needs the author to read it and rewrite the suite, and the narrowest wording heuristic (an action step with no check, followed by a check) also flags `submit the support form` and `submit the login form` in our own dogfood suite, which pass every run because they land on a different page where the evidence survives. Wording alone cannot tell the two apart. The runner can do the merge itself, for every suite, without a warning to read.

## What Changes

- A step that is neither a verification step nor carries a check clause, and is immediately followed in the same list by a verification step, is executed as `<step> and <next step>`: the acting model and the judge read the joined sentence. From there the existing rule for an act-and-verify step applies: its `done` is judged, with the check as the outcome.
- The next step still runs as written, as its own step. Nothing in the report, the step count or the score changes shape; the reports show the step as the author wrote it.
- Which values the model may type does not widen: a value only the next step names is not typeable in the joined step.

Measured with a prototype of this change, 0.32.0 plus the join, 10 runs on the notes test and 5 each on the dogfood login and support tests:

| Test | Haiku | Luna |
| --- | --- | --- |
| notes, split | 10/10 | 9/10 |
| support (split today, passes) | 5/5 | 5/5 |
| login (split today, passes) | 5/5 | 5/5 |

Luna's one failure was a correct verdict on a page with two notes: after its repeated click was refused, it pressed Enter in the field and submitted the form a second time. That gap in the repeated-commit refusal exists without this change and is reported separately.

## Non-goals

- **A wording warning.** The join removes the failure the warning was for. A last step that acts and checks nothing is a different question and stays in #44.
- **Joining more than one following check.** Only the step right after is joined. The rest run as they do today.
- **Steps in other languages.** The join uses the same English check verbs as `a-verification-step-only-looks`; a step those do not recognise runs as today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agentic-execution`: an action step followed by a check is judged on that check.

## Impact

- `src/runner/executor.ts`: the joined sentence for the model and the judge; the written step for events, reports and the value source.
- `src/runner/authoring.ts`: one exported helper that builds the joined sentence, beside the two classifiers it uses.
- `tests/`: unit tests for the helper and the executor.
- No prompt change, no judge change, no new dependency. `CHANGELOG.md`, `docs/writing-tests.md` (the outcome rule becomes a recommendation, no longer the difference between a pass and a false fail for this shape) and the `AGENTS.md` bullet on verification steps.
