## Why

A step can name exactly what must be true, and the agent can still fail it: it takes an action that does not produce the outcome, then checks the unchanged page again and again until the step runs out of attempts (#83).

Measured on OWASP Juice Shop with `anthropic/claude-haiku-4.5`, on the step `Type "apple" into the search field and verify the results show "Apple Juice (1000ml)", "Apple Pomace" and "Pineapple Juice (1000ml)"`. The step passed in 3 of 20 runs on `main`. In the failing runs the agent filled the field and never pressed Enter. Its reasoning shows why: it believed the fill had run the search ("The search results now display…"), and it read the 46 unfiltered products as a page of results. `openai/gpt-6-luna` passed 10 of 10, always with a fill and then Enter.

The loop gives the model what it needs to notice this, and puts it where Haiku does not read it. The failed check's reason arrives as `Previous action result:`, after a snapshot of several thousand lines. The record at the top of the prompt, "What you have ALREADY DONE in this step", lists only successful actions, so a failed check never appears there, and nothing says that the fill changed one textbox and nothing else.

Prototypes measured against the same step (20 runs each):

| Variant | Passed |
| --- | --- |
| `main` | 3/20 |
| A note on what the action changed, in `Previous action result` only | 3/20 |
| The same note, plus failed checks, in the record at the top | 9/20 |

Only what the record carries moved the model. The third variant did not regress the reliability benchmark (`npm run eval:reliability`, Haiku, 3 samples): the unmodified suite had 0/30 false FAIL on both, and the mutants 0/44 false PASS on `main` and 0/37 with the change (the last sample was cut short when the provider's credit ran out).

## What Changes

- The record the acting model receives at the top of its prompt also lists the step's failed checks, as `assert "<expectation>" -> assertion failed: <reason>`, in the order they happened.
- After a successful action, the executor compares the page the action was chosen on with the page that follows it, and appends one factual note to that action's entry in the record and to `Previous action result`:
  - ` (after it, the page did not change at all)` when no line of the snapshot changed;
  - ` (after it, the only change on the page: - <line>; + <line>)` when four or fewer lines changed;
  - nothing when more changed.
- The judge's record does not change. It still holds only the successful actions, without the notes.

## Non-goals

- **A rule about forms or search boxes.** "After a fill with no effect, press Enter" teaches the runner what a form is. The note says what changed on any page, for any action, and the model decides.
- **Refusing a repeated check.** Refusing to judge the same check on an unchanged page was prototyped and is not proposed: a warning that arrived in `Previous action result` did not change what the model did, and a refusal costs an attempt either way.
- **Changing the retry budget or the judge.** The judge decided every run correctly in #83. The fix is in what the acting model is told.
- **Closing the gap to Luna.** 7 to 9 of 20 is not 10/10. The rest is the model's, and the issue's own question, "how much of this is the model?", is answered by the Luna runs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agentic-execution`: what the step's record shows the acting model.

## Impact

- `src/runner/executor.ts`: a record for the acting model, kept beside `StepRecovery`'s, with failed checks and the page-change note.
- `src/llm/prompts.ts`: no change. The record's heading and format stay as measured.
- `tests/executor.test.ts`: the record's new entries, the note's three cases, the judge's record unchanged, masking.
- No new dependency. One more line per failed check in the prompt; the measured runs made fewer model calls with the change (297 against 337).
- Documentation: the CHANGELOG.
