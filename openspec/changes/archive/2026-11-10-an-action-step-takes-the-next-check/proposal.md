## Why

A step that names an action and stops, followed by a step that checks its result, fails on a correct application when the action erases its own evidence (#44). Measured on this repository's notes page, which redirects back to an empty form after a submit, with the same test written two ways and 10 runs each on 0.32.0:

| Wording | Haiku | Luna |
| --- | --- | --- |
| `submit the add-note form`, then `verify the note "Check the invoice" appears in the notes list` | 0/10 | 6/10 |
| `submit the add-note form and verify the note "Check the invoice" appears in the notes list` | 10/10 | 10/10 |

The application was correct in all 40 runs. In the split form the model clicks "Add note", sees an empty form, and sets out to prove "the form was submitted": it asserts that and the judge fails it, it tries to type the note again and is refused, or it fails the step for want of a value. Nothing tells either model that the note in the list is the evidence, because the step does not say so; the next step does.

#44 proposed a warning that tells the author to merge the two steps. A warning needs the author to read it and rewrite the suite, and the narrowest wording heuristic (an action step with no check, followed by a check) also flags `submit the support form` and `submit the login form` in our own dogfood suite, which pass every run because they land on a different page where the evidence survives. Wording alone cannot tell the two apart.

## What Changes

When a step is neither a verification step nor carries a check clause, and the next step in the same list is a verification step, the step is **judged** on that check, and the acting model still reads only the step as written:

- The acting model reads the written step, as today. It is never shown the check.
- The judge reads `<step> and <check>`. A `done` or an `assert` in the step is judged on that sentence, so the check is the outcome.
- When such a step is about to fail after at least one of its actions succeeded, the executor judges the check once on the current page first. If the check holds, the step passes.
- The check still runs as its own step. Reports, events and the source of typeable values keep the written step.

Measured with a prototype, 10 runs of the notes test and 5 of a page where the check is false (`open the shop page`, then `verify the page says "Mechanical Keyboard added to cart."` on a page where nothing was added):

| | notes, split (should pass) | false check (should fail) |
| --- | --- | --- |
| 0.32.0 | Haiku 0/10, Luna 6/10 | fails on both |
| this change, prototype | Haiku 10/10, Luna 9/10 | fails 5/5 on both; "Add to cart" never clicked |
| this change, as implemented | Haiku 10/10, Luna 8/10 | fails 5/5 on both; "Add to cart" never clicked |

Luna's failures are submits it made twice, which the page then showed: after its repeated click was refused it pressed Enter in the field (two notes listed, a correct verdict on the count), or it clicked "Add note" twice in a row and the second, empty submit left "Note is required" on the page. That gap in the repeated-commit refusal exists on 0.32.0 and is outside this change.

## Non-goals

- **A wording warning.** The judged step removes the failure the warning was for. A last step that acts and checks nothing is a different question and stays in #44.
- **Joining more than one following check.** Only the step right after is used.
- **Steps in other languages.** The rule uses the same English check verbs as `a-verification-step-only-looks`; a step those do not recognise runs as today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agentic-execution`: an action step followed by a check is judged on that check.
- `reliability-benchmark`: a mutant whose seeded bug fails the test at the step judged on its declared step is caught, not caught elsewhere.

## Impact

- `src/runner/executor.ts`: the judged sentence for the judge, the written step for the acting model and for everything a person reads; one judgment before an acted step fails.
- `src/runner/authoring.ts`: one exported helper that builds the judged sentence, beside the two classifiers it uses.
- `src/runner/recovery.ts`: the step's closing rule reads the judged sentence, its value source the written one.
- `src/runner/budget.ts`: the dry-run ceiling counts the judgment before failing.
- `evals/reliability/`: the scoring above, and the new mutant.
- `tests/`: unit tests for the helper and the executor, and a reliability mutant for the false-check shape.
- No prompt change, no judge change, no new dependency. `CHANGELOG.md`, `docs/writing-tests.md`, `README.md` and the `AGENTS.md` bullet on verification steps.
