# Design: judge-the-outcome-not-the-means

## Context

Read and measured rather than assumed:

**The inputs.** `evals/judge/cases/issue-121.json` holds the seven judge inputs captured for #121 during the #120 investigation (OWASP Juice Shop `main` built 2026-09-27, `anthropic/claude-haiku-4.5` through OpenRouter). Each has the same step: *"Dismiss the cookie consent dialog by clicking "Me want it!" and verify the consent dialog is gone"*. The dialog is absent in all seven, so PASS is correct in all seven. Five are marked `knownFailing: #121`.

**Are the labels right?** Three of the seven snapshots show only the Welcome modal. If the modal hid the rest of the page from the accessibility tree, the consent dialog could be there unseen, and FAIL would be the right verdict. On a fresh load of the same build, 2026-10-03, the snapshot holds both `dialog "cookieconsent"` with its `"dismiss cookie message": Me want it!` button and the Welcome dialog. A snapshot showing only the modal therefore means the consent dialog is gone. The labels stand.

**The two paths.** At temperature 0 each input gets the same verdict on every sample, so the measurement is about inputs, not luck.

- *Login page* (4 inputs, no dialog of any kind). Two pass already: their claim says the dialog is gone. Two fail: *"the snapshot shows no cookie consent dialog visible at all … so the dismissal action and its outcome cannot be verified"*.
- *Welcome modal* (3 inputs). All three fail: *"the snapshot shows a Welcome dialog is still present … not a cookie consent dialog … the consent dialog has not been dismissed or is not the dialog shown"*.

**What it is not.** The five failing inputs, with the input changed, 3 samples each:

| change to the input | PASS |
| --- | --- |
| claim replaced by "The step is complete." | 6/15 |
| claim replaced by "The cookie consent dialog is not on the page." | 0/15 |
| "by clicking "Me want it!"" removed from the step | 0/15 |
| step replaced by "Verify the cookie consent dialog is not shown" | 10/15 |

The claim does not decide it, and neither does the named means. The verb does: a step that *dismisses* is read as requiring a dismissal. Only a step with no action in it gets through, and it still fails twice on the modal path.

**What #120 measured.** `ask-the-judge-about-the-step` recorded that no variant moved #121, and that a per-outcome structure fixed less. That structure listed the step's outcome clauses with a verdict each. This one asks for one sentence, the outcome with the action taken out. It was not among the variants measured then.

## Goals / Non-Goals

**Goals:** a step whose outcome holds passes whatever the state of its action; nothing failing correctly today starts passing; nothing passing correctly today starts failing.

**Non-Goals:** the modal path, checking the means, the executor.

## Decisions

### D1: The judgment states the outcome before deciding it
```ts
outcome: z.string().describe(
  'The state the STEP asks for, rewritten as a sentence about the page with its action removed: ' +
  '"click Save and verify the note is listed" becomes "the note is listed"; "open the Account menu and ' +
  'verify it shows the email" becomes "the Account menu shows the email".'),
reason: z.string().describe('One sentence: whether the snapshot shows that outcome.'),
```
Structured output is generated in schema order, so the rewrite exists before the reason does. The model then decides a sentence with no verb to satisfy. That is the input shape the table shows getting through. `ask-the-judge-about-the-step` D2 used the same order for the same purpose.

The examples are not dismissals. The version measured in D4 used *"dismiss the banner by clicking OK and verify it is gone"*, which is close enough to the corpus step to be doing the work itself. Replaced by the Account-menu example, the corpus result is the same (task 2.2).

### D2: The verdict says what the action is
`pass` keeps its description and gains two sentences: *"An action the step names (click, dismiss, submit) is how its outcome is reached, not part of it: an outcome that holds passes whether or not that action was needed. An outcome that is an absence (gone, closed, dismissed, removed) is shown by the thing being absent."* The second answers *"no dialog visible at all … cannot be verified"* directly. Under the existing *"False if any part of the outcome … is not shown"*, an absence reads as something not shown.

### D3: The prompt says an outcome can hold before the step acts
A paragraph after the existing ACTION paragraph, which covers the control a successful action removes but not an outcome reached before the step began:

> An outcome may already hold before this step acts: an earlier step, or the application itself, got there first. A step asking for something to be gone, closed or dismissed is satisfied by that thing being absent from the snapshot. It does not also require the thing to have been there, or this step to have removed it, and a different element that is present (another dialog, another banner) is not the one the step names. Whether the step's action ran is not what you decide: judge the state the step asks for.

### D4: All three, because each one left out leaves a wrong FAIL
On the four login-page inputs, 3 samples each:

| variant | login page (PASS) | modal (PASS) | controls (FAIL) |
| --- | --- | --- | --- |
| current | 6/12 | 0/9 | 9/9 |
| D2's first sentence, no D1 ¹ | 6/12 | 0/9 | — |
| D2 + D3, no D1 ¹ | 6/12 | 0/9 | — |
| D1 + D3 | 6/12 | 0/9 | — |
| D1 + D2 | 9/12 | 0/9 | — |
| **D1 + D2 + D3** | **12/12** | 0/9 | **9/9** |

¹ Without D1 there is no outcome to point to, so `reason` was reworded instead: *"the state the STEP requires to be true now — not the action it names to reach it — and whether the snapshot shows that state"*. It is the nearest thing to D1 without a field of its own, and it moved nothing.

D1 + D2 + D3 across the whole corpus, 3 samples: every case not marked `knownFailing` right in 3/3, and the two login-page markers now right in 3/3. Each part is prose, so the guarantee is the corpus, not the wording. That is the fragility `ask-the-judge-about-the-step` D5 met, and here there is no token to check in code instead: *"the thing is absent"* is a reading of the page.

### D5: The means is not judged
The issue asks whether the means is ever part of the contract. The judge sees a snapshot, which records a state and not the path to it, so it cannot tell a dismissal from a dialog that was never shown. Requiring the action makes every step whose precondition an earlier step met fail, and a judge cannot verify one anyway. Where the means matters, the step names what the means leaves on the page. The authoring reference says so in its table of what is and is not enforced.

### D6: Controls in the direction this could break
Judging the outcome makes a PASS easier to reach. Three FAIL cases bound it, with snapshots captured from Juice Shop on 2026-10-03 and step, claim and record written to probe:

- the consent dialog still shown, claim saying it is gone;
- the Welcome banner closed by the record, the consent dialog still shown, claim saying "the dialog has been dismissed";
- a step closing the Welcome banner, the banner still open, claim about the consent dialog.

Each is right 3/3 under both the current judge and D1 + D2 + D3. They are `reconstructed`, since the step and claim were written for them.

### D7: The modal path moves to its own issue
Two more wordings were measured on it: the reason naming the thing *"by its name, not by its kind"*, and the outcome keeping *"every word the step uses to name the thing"*. Both gave the identical 0/9, with reasons unchanged word for word. Its three cases are re-marked to the new issue, so #121 closes with its own path fixed and the other one still visible.

## Risks / Trade-offs

- **[A step whose means mattered passes.]** Accepted, per D5, and documented for authors.
- **[D1's example was the measured case.]** Resolved: replaced by a non-dismissal example with the same corpus result. The D4 table was measured with the first one.
- **[Measured on one model.]** As with every corpus result here: `anthropic/claude-haiku-4.5` at temperature 0.
- **[`outcome` is returned and not used.]** A report could show it beside the reason. Left out, because no reported failure needed it.
