# Design: ask-the-judge-about-the-step

## Context

Read and measured rather than assumed:

**The judge has three callers and one body.** `executor.ts` calls `brain.judge` for the first judgment and for the re-observation, and `auth.ts` calls it to verify a login. All three pass through `judge()` in `brain.ts`. A change there covers every verdict, which is the choke-point rule `AGENTS.md` asks for.

**A placeholder is not masked, by design.** The mask replaces *values*. `{{env.TEST_OTHER}}` in a step is text naming a variable, so it reaches the judge as written, while the page carries `[redacted TEST_EMAIL]`. The judge prompt explains that a label is the value of `{{env.NAME}}`, but the model has to perform that mapping itself, and in the captured inputs it did not.

**The schema still asks the old question.** `assertJudgmentSchema.pass` is described as *"Whether the snapshot satisfies the expectation."* `judge-the-step` moved the prompt to "decide whether the STEP's own outcome holds", and the schema description, which the model also reads, still asks about the expectation. Its field order is `pass`, then `reason`: the verdict comes first and the reasoning justifies it.

**The measurement method.** Two QA tests against a live OWASP Juice Shop, 5 runs, every judge input captured by a local, uncommitted hook. The captured inputs were then replayed through candidate judges, with the same system and user prompts, at temperature 0, 3 samples each. 19 distinct inputs: 2 of the placeholder path, 6 of the weakened-expectation path, 7 of #121, 4 controls. Three weakened-expectation inputs were in both extraction passes and were replayed twice, which is why that column totals 27 samples; it doesn't change any rate.

| variant | placeholder × label (FAIL) | weakened (FAIL) | #121 (PASS) | controls (PASS) |
| --- | --- | --- | --- | --- |
| current | 0/10 | 25/30 | 10/35 | 20/20 |
| labels only | 0/6 | 21/27 | 6/21 | 12/12 |
| schema only | 3/6 | 27/27 | 6/21 | 12/12 |
| **both** | **6/6** | **27/27** | 6/21 | 12/12 |
| per-outcome structure | 3/6 | 27/27 | 9/21 | 12/12 |

## Goals / Non-Goals

**Goals:** both measured wrong-PASS paths closed, by code where a prompt proved insufficient; nothing that passes correctly today starts failing; a later judge change cannot reopen a fixed incident without a red result.

**Non-Goals:** #121, a structured verdict, the executor's prompt.

## Decisions

### D1: Placeholders become labels inside `judge()`
`judge()` rewrites `{{env.NAME}}` as `redactionLabel(NAME)` in the step, the expectation and each record entry, then builds the prompt as today. The helper lives in `env.ts`, beside `redactionLabel` and `ENV_PLACEHOLDER`: the definition of a placeholder and the definition of a label stay in one file, so the two vocabularies cannot drift apart. The same lesson #66 recorded, when two regexes for "a placeholder" had already disagreed.

The executor's prompt is untouched. Its model must type `{{env.NAME}}` for the substitution to happen, so showing it a label there would break every fill.

### D2: The schema asks about the step, reason first
```ts
z.object({
  reason: z.string().describe("One sentence: what the STEP requires to be true now, and whether the snapshot shows it."),
  pass: z.boolean().describe("Whether the snapshot shows the STEP's own outcome. The expectation is only a claim offered in support; it never replaces the step. False if any part of the outcome the step asks for is not shown, or cannot be assessed from this snapshot."),
})
```
Field order is part of the change: structured output is generated in schema order, so the reason now precedes the verdict instead of justifying it after the fact. These are exactly the descriptions measured as "schema only" and "both".

### D3: Both, because neither alone suffices
Labels alone left the placeholder path at 0/6: the judge had the vocabulary and was still asked about the expectation, which the executor had already bridged falsely. The schema alone got 3/6: asked about the step, the judge still had to translate `{{env.TEST_OTHER}}` itself. Each removes a different half of the error.

### D5: A step naming one secret cannot pass on a page showing only another
Verified live against Juice Shop after D1 and D2, the test built to fail still passed in 2 of 5 runs. In both, the judge was given `[redacted TEST_OTHER]` in the step and `[redacted TEST_EMAIL]` on the page, the exact vocabulary D1 provides, and wrote *"[redacted TEST_EMAIL], which matches the expected [redacted TEST_OTHER]"*. D1 and D2 halved the rate (2 of 4 runs that reached the menu, against 2 of 2 before); they did not close it. The corpus had only two inputs on this path and both were fixed, which is why the replay did not show it.

So the last step is code. After the model's verdict, `judge()` fails a PASS when the judged step names `[redacted X]`, X's label is in neither the snapshot nor the judged record, and the snapshot shows some other label. Labels are tokens the mask writes, not prose, so this is a comparison of our own output, not the grammar heuristic #72 rejected.

The two conditions beyond "X is not on the page" are what keep it from failing correct steps:
- **The record**: a step that typed `{{env.TEST_EMAIL}}` into a form it then submitted names a secret the page no longer shows. The record of its own fill carries the label.
- **Another label present**: a step asserting a secret is *absent* is right when the page shows none. The check only fires when there is another secret on the page for the judge to have mistaken for X, which is the failure observed.

What it cannot tell apart: a step asserting X is absent, on a page that shows a different secret. It fails that step. Recorded under Risks.

### D4: A committed regression corpus for the judge
Nine changes have touched the verdict since July (`assertion-ends-step`, `trustworthy-verdicts`, `judge-the-step`, `judge-sees-the-record`, `deterministic-verdicts`, `close-a-step-on-what-was-done`, `label-a-redaction-with-its-variable`, this one, and #121 still open). Each fixed a distinct failure mode, and none was traced to an earlier fix: the strongest candidate, #121 as a side effect of `judge-sees-the-record`, was replayed without the record and fails identically (6/21 both ways). But each was verified against its own reproduction plus a dogfood suite that has no `{{env.*}}` value, no compound step and no precondition already met. A change to the judge could reopen #31 or #87 and nothing would turn red. That gap is where #87's fix missed the placeholder form, which #100 then made common.

`evals/judge/` holds one JSON file per incident. Each case carries the step, expectation, snapshot and record the judge reads, the correct verdict, the issue it comes from, and its provenance: `captured`, copied from a real run's judge input, or `reconstructed`, rebuilt from an archived design where no capture exists, with the passage it was built from. A case currently judged wrong is marked `known_failing` with its issue. `npm run eval:judge` replays every case through the real `judge()`, 3 samples each, and exits non-zero if a case not marked `known_failing` is judged wrong in any sample. It reports, without failing, a `known_failing` case that has started passing, so the marker gets removed rather than outliving its bug.

It needs a model and a key, so it is not part of CI. It runs before a change to the judge merges, as the dogfood suite runs before a release. A vitest test checks the corpus is well-formed (every case has a verdict, an issue and a provenance), so the files cannot rot in CI even though their replay is opt-in.

The corpus is masked text only: it holds labels where values were, never a value.

## Rejected alternatives

- **A per-outcome structured verdict** (#120's proposal). It fixed 3/6 on the placeholder path, worse than both changes together, and replaces the verdict's shape where a description change sufficed.
- **Showing the executor labels too.** It would stop the false bridge at the source, and break every `{{env.*}}` fill.
- **A prompt sentence about disjunctive expectations.** The prompt already forbids passing on a claim about something else. Prompts are where this rule already was.

## Risks / Trade-offs

- **The sample is small and from one application.** 19 distinct inputs, 4 of them controls. → The corpus (D4) adds the earlier incidents as controls in the other direction, and verification still reruns the dogfood suite and the Juice Shop runs that found it.
- **D5 fails a correct negative assertion when another secret is on the page** ("verify `{{env.TEST_PASSWORD}}` is not shown", on a page showing the user's email from `{{env.TEST_EMAIL}}`). → The reason names both labels and says why, so the author sees it at once; the alternative is the silent wrong PASS this change exists to close. If it proves common, the remedy is the author splitting that assertion from pages carrying other secrets, not loosening the check.
- **Reconstructed cases are weaker evidence than captured ones.** → Marked as such, with the archived passage they come from, so a reader can weigh them.
- **A stricter judge can fail steps that pass today for the right reason.** The new description fails a step when part of its outcome "cannot be assessed". → That is the intent, and the dogfood suite is where an over-strict judge would show first.
- **#121 is unchanged**, so a step whose means is no longer needed can still fail. → Its own change, next.

## Migration Plan

None. Verdicts may change where they were wrong.

## Open Questions

- **Which model is the corpus's reference?** It is replayed against the configured one, and a verdict can differ by model. The cases are recorded against `anthropic/claude-haiku-4.5`; another model may need its own `known_failing` markers.
