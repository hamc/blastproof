# Jev as a judge

**Result:** not usable as blastproof's judge, or as a second judge. Measured on `jev-1.13` on 2026-10-13 ([#174](https://github.com/hamc/blastproof/issues/174)).

[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) is TypeSafe AI's decision model. It takes a state and typed questions (choice, score, or a yes/no `noul`) and returns probabilities with a confidence. It generates no text.

## Which roles it could take

| role | needs | Jev |
| --- | --- | --- |
| choosing the next action (`nextAction`) | a typed value, a URL, a reasoning, a claim | no: it generates no text |
| drafting tests (`plan`) | YAML steps | no: it generates no text |
| judging a step (`judge()`) | a yes/no verdict | can answer it, so this was measured |

The judge also writes the step's outcome and a reason before its verdict. Both were needed to fix real wrong verdicts (#120, #121), and the reason is what a failed step shows in its report. Jev answers the verdict alone, without either.

## What the public documentation says

From the [models page](https://docs.typesafe.ai/models.md) and the [known limitations of jev-1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md):

- **Cost:** $0.042 per million input tokens. Output tokens are free.
- **Context:** 64k tokens per request, 32k for the state plus the longest question.
- **Accuracy:** no benchmark is published. The limitations page lists the cases a judge meets most often: it "struggles with tasks that require numeric precision", "can be quite literal", reads dates "as text, not as ordered quantities", loses accuracy "as the state grows with content unrelated to the decision" (a page snapshot is mostly unrelated to one step), and "leans toward the option that comes first".

## Measured

The [judge corpus](../../evals/judge/) has 41 cases from real verdict incidents, with known correct verdicts. 25 of them should FAIL. Each case was asked as one `noul` question. The judge's own system prompt was the instructions, and the judge's own user prompt was the state, so Jev saw what the LLM judge sees. A probability of "yes" of 0.5 or more counts as PASS. 3 samples per case, through OpenRouter.

| judge | cases right in every sample | false PASS (cases that should FAIL) | cost of 123 judgments |
| --- | --- | --- | --- |
| `typesafe/jev-1.13` | 34 of 41 | **6 of 25** | $0.010 |
| `anthropic/claude-haiku-4.5`, current judge | 39 of 41 | 0 | about $0.3 for both LLMs |
| `openai/gpt-6-luna`, current judge | 41 of 41 | 0 | |

Haiku's two misses are #129, already known. The LLM cost is the account's spend over that run, for both models together; `eval:judge` reports no cost per model. Per judgment, Jev was roughly 16 times cheaper.

### Where it fails

All six false PASSes are #120's shape: the page shows the right kind of value, but a different secret's label (`[redacted DEMO_EMAIL]` against another variable's). No threshold separates them. Jev gave those wrong cases 0.62 to 0.79 for "yes", and the correct controls on the same page 0.60 to 0.82. A stricter threshold fails the controls before it catches the errors.

Its one miss on a case that should pass is one of #121's cases: a cookie banner the step asks to dismiss is already gone, and another dialog is open. Haiku misses that one too (#129).

Two other ways of asking, with the page as JSON fields and a shorter instruction, did worse: 32 of 41 and 30 of 41. Those variants also missed #147's shape, a value in the wrong place on the page.

### As a second judge

A second model that must agree before a high-priority step passes (#145) is useful when it catches the main judge's false PASSes. Jev's errors are the same kind of false PASS, so it would not catch them. Where it disagrees with a correct PASS (#121), it would block a merge for nothing.

### Cost in a whole run

The judge is a minority of a run's calls. Choosing the action reads the same snapshot, and it needs an LLM in any case. A Jev judge would save part of the judge's share, at the price of the verdicts above.

## Measuring a later version

```bash
OPENROUTER_API_KEY=… JEV_MODEL=typesafe/jev-1.13 npx tsx evals/judge/jev.ts
```

It prints each case with its probabilities, the cases right in every sample, the false PASSes, and the cost: about one cent. For the current judges on the same corpus:

```bash
EVAL_MODELS=anthropic/claude-haiku-4.5,openai/gpt-6-luna EVAL_SAMPLES=3 npm run eval:judge
```

A version worth a second look has no false PASS on the corpus, and a gap between the probabilities of wrong and right cases that a threshold can use.
