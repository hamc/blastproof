# Jev as a judge

**Result:** on the judge corpus, as accurate as the current judges: 40 of 41 cases right, no false PASS. It writes no reason for a failed step, and the agent's retry reads that reason, so it is not a drop-in judge. How much that costs has not been measured. Measured on `jev-1.13` on 2026-10-14 ([#174](https://github.com/hamc/blastproof/issues/174)).

[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) is TypeSafe AI's decision model. It takes a state and typed questions (choice, score, or a yes/no `noul`) and returns probabilities with a confidence. It generates no text.

## Which roles it could take

| role | needs | Jev |
| --- | --- | --- |
| choosing the next action (`nextAction`) | a typed value, a URL, a reasoning, a claim | no: it generates no text |
| drafting tests (`plan`) | YAML steps | no: it generates no text |
| judging a step (`judge()`) | a yes/no verdict | can answer it, so this was measured |

## What the public documentation says

From the [models page](https://docs.typesafe.ai/models.md) and the [known limitations of jev-1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md):

- **Cost:** $0.042 per million input tokens. Output tokens are free.
- **Context:** 64k tokens per request, 32k for the state plus the longest question.
- **Accuracy:** no benchmark is published. The limitations page lists the cases a judge meets most often: it "struggles with tasks that require numeric precision", "can be quite literal", reads dates "as text, not as ordered quantities", loses accuracy "as the state grows with content unrelated to the decision" (a page snapshot is mostly unrelated to one step), and "leans toward the option that comes first".

## Measured

The [judge corpus](../../evals/judge/) has 41 cases from real verdict incidents, with known correct verdicts. 25 of them should FAIL. Each case was asked as one `noul` question, with the input `judge()` gives the LLM: the judge's system prompt as the instructions, and its user prompt as the state, with every `{{env.NAME}}` in the step, the claim and the record rewritten as `[redacted NAME]`. A probability of "yes" of 0.5 or more is a PASS, and then goes through the same label check `judge()` applies to the LLM's verdict. 3 samples per case, through OpenRouter.

| judge | cases right in every sample | false PASS (cases that should FAIL) | cost of 123 judgments |
| --- | --- | --- | --- |
| `typesafe/jev-1.13` | 40 of 41 | 0 of 25 | $0.010 |
| `anthropic/claude-haiku-4.5`, current judge | 39 of 41 | 0 | about $0.3 for both LLMs |
| `openai/gpt-6-luna`, current judge | 41 of 41 | 0 | |

Jev's one miss is one of #121's cases: a cookie banner the step asks to dismiss is already gone, and another dialog is open. Haiku misses that one too, and Haiku's other miss is the same incident (#129). The LLM cost is the account's spend over that run, for both models together; `eval:judge` reports no cost per model. Per judgment, Jev was roughly 16 times cheaper.

The probabilities leave a margin around the threshold. Every case that should pass got 0.70 or more, except the miss (0.30 to 0.40). Every case that should fail got 0.38 or less, except the eight below.

### What the label check does

Eight of the 25 FAIL cases are #120's shape: the step names one secret, and the page shows a different secret's label. Jev gave those 0.43 to 0.76 for "yes", above 0.5 in all but one sample, and the label check failed all eight. That check is not a concession to Jev: it exists because the LLM judge called those labels a match too, and every LLM verdict goes through it. Without it, Jev would have 8 false PASSes. How many the current judges would have without it was not measured.

### What a judge without a reason loses

An LLM judgment carries a sentence saying why. It goes to three places:

- **the agent's retry.** A failed judgment does not end the step. The step is retried, up to `max_retries_per_step`, and the acting model reads `assertion failed: <reason>` to decide what to do next: submit the form it filled, scroll to the row, wait. With Jev it reads only that the check failed.
- **the step's record**, which the acting model and the judge read again on the next attempt.
- **the report.** A failed step's reason is what the terminal, the JUnit and the HTML report show.

The corpus measures one judgment at a time, so it cannot see the first two. Their cost would show up as false FAILs in whole runs, which needs Jev wired into `judge()` and `npm run eval:reliability`.

### Correction

The first measurement, on 2026-10-13, reported 34 of 41 and 6 false PASSes, and concluded that Jev was not usable as the judge or as a second one. That script passed the step with its raw `{{env.NAME}}` placeholders against a page that shows `[redacted NAME]` labels, which is #120's original defect, and did not apply the label check. The six false PASSes were all #120 cases the label check fails. Both are fixed in `evals/judge/jev.ts`.

## Measuring a later version

```bash
OPENROUTER_API_KEY=… JEV_MODEL=typesafe/jev-1.13 npx tsx evals/judge/jev.ts
```

It prints each case with its probabilities, marks the cases the label check failed, and ends with the cases right in every sample, the false PASSes, and the cost: about one cent. For the current judges on the same corpus:

```bash
EVAL_MODELS=anthropic/claude-haiku-4.5,openai/gpt-6-luna EVAL_SAMPLES=3 npm run eval:judge
```
