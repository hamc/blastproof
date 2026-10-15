# Jev as a judge

**Result:** not used as the judge. On the judge corpus it is as accurate as the current judges: 40 of 41 cases right, no false PASS. In whole runs on a real budgeting app, as the only judge it failed a correct test in 3 runs of 3, and as a first pass in front of the LLM judge it was as accurate, 13% cheaper and 7% faster, with every pass it gave final and without a reason. Measured on `jev-1.13` on 2026-10-14 ([#174](https://github.com/hamc/blastproof/issues/174)).

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

The corpus measures one judgment at a time, so it cannot see the first two. Their cost would show up as false FAILs in whole runs, measured below.

## Measured in whole runs

Jev was wired into `judge()` behind an environment variable, on a branch that was not merged, in two ways:

- **`jev`:** Jev decides every judgment. A failed one carries a fixed reason saying the judge gives none.
- **`jev-first`:** a judgment Jev passes is passed. One it fails goes to the LLM judge, which decides it.

Both went through the same budget, timeout and label check as the LLM judge. The acting model was `claude-haiku-5.5` throughout.

**The reliability benchmark** (the demo app: 40 runs of the correct app, 50 mutants): 0 false FAIL and 0 false PASS for the LLM judge, `jev` and `jev-first` alike. It does not tell them apart.

**A real budgeting app**, 21 tests, 3 runs each:

| judge | score in 3 runs | model calls per run | tokens per run |
| --- | --- | --- | --- |
| LLM judge | 100, 100, 95 | 322 | 1.85 M |
| `jev` | 95, 95, 90 | 305 | 1.60 M |
| `jev-first` | 100, 100, 95 | 347 | 1.79 M |

The 95s in the LLM judge's and `jev-first`'s rows are one test about a due schedule, which failed once under every judge.

**Under `jev`**, a test creating a rule failed in every run, on the same step: choose a payee in the rule's condition, and verify the condition reads that payee. The page showed it, in a field of the rule form, which stays open until the rule is saved. The judge's prompt tells it that a value in an unsubmitted form is not an outcome, and Jev applied that to a step whose outcome is the form's own content. Its documented limitation is this one: it "can be quite literal". The LLM judge passed that step in all 6 of its runs. The retries that followed the failure read the fixed reason, and nothing they did could change the verdict, so the missing reason was not what failed the test.

**Under `jev-first`**, Jev failed about 25 judgments per run, and the LLM judge overturned 6 of the 51 it was sent in the two runs logged. Five of the six were a value in an open dialog's field, Jev's reading above. The 45 it upheld were mostly the demo budget still loading. Every judgment Jev fails costs two calls instead of one, so the run made more calls than with the LLM judge alone.

Calls and tokens do not give the cost, because Jev's tokens are cheaper than the LLM's. One more run of each, on 2026-10-15, with every LLM call's billed cost recorded through a proxy, and Jev's tokens priced at its list price ($0.042 per million input tokens, output free):

| judge | tests passed | LLM calls | Jev calls | cost of the run | time (sum of tests) |
| --- | --- | --- | --- | --- | --- |
| LLM judge | 21 of 21 | 315 | 0 | $0.202 | 1,273 s |
| `jev-first` | 21 of 21 | 242 | 100 | $0.176 ($0.162 LLM + $0.014 Jev) | 1,180 s |

13% cheaper and 7% faster. The saving is bounded by the judge's share of the run: about a third of the calls, the rest being the acting model's, which Jev does not replace. Jev also reads the same page, at about 2.6 times less per token than `claude-haiku-5.5` cost here ($0.11 per million), not the 16 times measured against the corpus's two models. Against a more expensive acting model the share saved would be larger.

The earlier version of this section said `jev-first` saved nothing, from a 3% token saving. That counted Jev's tokens as if they cost what the LLM's do.

### Decision

Jev is not the judge, and not the default first pass. The code was not merged.

- **Alone**, it fails a correct test in every run. What would reopen it: a version that reads an open form's content as the outcome when the step asks for it.
- **As a first pass**, it works, but every pass it gives is final: the LLM judge sees only what Jev fails, so Jev's false PASS rate becomes the run's. It had none here, on 75 cases that should fail (25 in the corpus, 50 mutants), which is too few to hand it that decision by default for 13%. A pass also comes with no reason, and a reason is how wrong passes were diagnosed before (#87, #120, #147). An opt-in experimental option, off by default, is planned.

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
