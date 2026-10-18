# Decision models as a first judge

**Result:** worth it as a first pass in front of the LLM judge, at a threshold of 0.7 with the label check on, and not as the only judge. Measured on TypeSafe AI's `typesafe/jev-1.13` and Liquid AI's `liquid/d1-ultra` (2026-10-15 snapshot) on 2026-10-14 to 2026-10-17 ([#174](https://github.com/hamc/blastproof/issues/174)). Neither let a planted bug through in 162 runs; both made every run on a real app cheaper and faster. `d1-ultra` separated correct pages from broken ones more widely than Jev. Not the default. It ships as an opt-in experimental option, [`first_judge`](../configuration.md#first_judge--a-decision-model-before-the-judge-experimental) ([#184](https://github.com/hamc/blastproof/issues/184)).

A decision model takes a state and typed questions and returns probabilities. It generates no text. Both are served on OpenRouter's Decisions API (`/api/alpha/decisions`), asked here as one yes/no `noul` question.

## Which roles one could take

| role | needs | a decision model |
| --- | --- | --- |
| choosing the next action (`nextAction`) | a typed value, a URL, a reasoning, a claim | no: it generates no text |
| drafting tests (`plan`) | YAML steps | no: it generates no text |
| judging a step (`judge()`) | a yes/no verdict | can answer it, so this was measured |

## What the public documentation says

- **Price:** both billed $0.042 per million input tokens, output free. For the same text `d1-ultra` counts fewer tokens: about 15% fewer on the real app's pages.
- **Context:** Jev takes 64k tokens per request, 32k for the state plus the longest question ([models page](https://docs.typesafe.ai/models.md)).
- **Known limitations of Jev** ([jev-1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)): it "struggles with tasks that require numeric precision", "can be quite literal", reads dates "as text, not as ordered quantities", and loses accuracy as the state grows with unrelated content. Six of the planted bugs below aim at the first and third.

## How it was asked

The judge's system prompt is the instructions, its user prompt the state, with every `{{env.NAME}}` in the step, the claim and the record rewritten as `[redacted NAME]`, as `judge()` does for the LLM. A probability of "yes" at or above the threshold is a PASS, and then goes through the same label check every LLM verdict goes through.

In whole runs it was wired into `judge()` behind an environment variable, on a branch that was not merged, through the same budget and timeout as every model call, in two ways:

- **alone:** the decision model decides every judgment; a failure carries a fixed reason saying it gives none.
- **first:** a judgment it passes is passed; one it fails goes to the LLM judge, which decides it and writes the reason.

`claude-haiku-5.5` was the LLM judge and the acting model throughout.

## The judge corpus

The [judge corpus](../../evals/judge/): 41 cases from real verdict incidents, 25 of which should FAIL, 5 samples each.

| judge | cases right in every sample | false PASS |
| --- | --- | --- |
| `typesafe/jev-1.13` | 40 of 41 | 0 of 25 |
| `liquid/d1-ultra` | 40 of 41 | 0 of 25 |

Both miss one of #121's cases (a dialog already dismissed, another open). Haiku 4.5 misses #121 cases too (#129). Each replay costs about a cent.

### The label check is required

Thirteen of the FAIL cases are decided by the label check alone: the step names one secret and the page shows another's label. Without the check, sampled at each threshold:

| judge | wrong PASS, of the 13 cases' samples |
| --- | --- |
| `jev-1.13` at 0.5 / 0.7 / 0.8 | 39 / 17 / 0 of 65 |
| `d1-ultra` at 0.5 / 0.7 / 0.8 | 26 / 19 / 4 of 65 |
| `claude-haiku-5.5` | 6 of 39 |
| `claude-haiku-4.5` | 3 of 39 |
| `gpt-6-luna` | 0 of 39 |

With the check, none of them gives one. A decision model must never run without it.

## Whole runs on a real budgeting app

21 tests, five runs per setup (three for the model alone), every LLM call's billed cost recorded through a proxy, the decision model's tokens priced at its list price.

| judge | cost per run | time per run | LLM calls | decision calls | scores |
| --- | --- | --- | --- | --- | --- |
| `claude-haiku-5.5` | $0.205 ± 0.005 | 372 ± 15 s | 320 | 0 | 100, 100, 100, 95, 95 |
| Jev first, 0.7 | $0.175 ± 0.005 | 322 ± 5 s | 243 | 99 | 100, 95, 95, 95, 100 |
| `d1-ultra` first, 0.7 | $0.170 ± 0.002 | 331 ± 10 s | 237 | 98 | 95, 92, 100, 100, 100 |
| `d1-ultra` alone, 0.5 | $0.165 | 313 s | 217 | 97 | 100, 100, 100 |

Every run with a decision model first was cheaper and faster than every run without one (Mann–Whitney, p ≈ 0.008 on cost and 0.016 on time, where one baseline run has no time recorded). The saving is bounded by the judge's share of a run, about a third of the calls; the rest are the acting model's. Against a more expensive acting model it would be larger.

No failure in these runs was a wrong verdict. Each was the acting model's: it typed an account or a category without picking it from the list, and the record was saved without it, or it opened a split transaction by mistake. Every judge failed those tests, rightly.

`d1-ultra` alone ran with a variant of the judge's criteria that reads an open form's content as the outcome when the step asks for it. Jev alone, with the original criteria, failed a correct test in 3 runs of 3 for that reason (a payee shown in an unsaved rule form). Three runs is a hint, not a result.

## Same page, three judges

In separate runs, every judgment was also asked of the other judges on the same page, logged, and never deciding. This takes the acting model's randomness out of the comparison. Disagreements were checked against the saved page, not against the LLM's verdict.

**On the real app**, 501 judgments, at 0.7 with the label check:

| | agrees with `claude-haiku-5.5` | fails where it passes | passes where it fails |
| --- | --- | --- | --- |
| `jev-1.13` | 461 | 40 | 0 |
| `d1-ultra` | 494 | 0 | 7 |

Jev's 40 were Jev being literal: the page was right, mostly a value chosen in a form the step asked about. As a first pass that costs an LLM call, not a wrong verdict. In all 7 of `d1-ultra`'s, `claude-haiku-5.5` was wrong: the step asked what a rule form showed, the form showed it, and the LLM failed it for not being saved (exact binomial, p ≈ 0.016).

**On planted bugs**, the demo app with 16 mutants, at least 10 runs each, 162 runs in all: no judge passed a step showing its bug, at any threshold from 0.5 to 0.8, over 284 judgments of the bug step. Six mutants aim at numbers and dates: a total of $114.00 or $14.10 for $141.00, a cart total 60 cents high, an order dated a day late, two orders' dates or totals swapped. The highest probability any bug got:

| judge | highest p(yes) on a bug |
| --- | --- |
| `jev-1.13` | 0.17 (10% discount where the step asks 20%) |
| `d1-ultra` | 0.07 |

Zero in 162 bounds the rate of a wrong PASS on bugs like these below about 2% at 95% confidence, for each judge. It does not separate them.

## Threshold

At 0.7 every bug stayed below the line by a wide margin. A higher line mostly sends correct steps to the LLM: on the real app's paired judgments, Jev passed 71% at 0.7 and 61% at 0.8; `d1-ultra` 81% at either.

## Decision

Not shipped as the default.

- **Alone**, a decision model's failure has no reason, and the agent's retry and the report read that reason. Jev alone also failed a correct test in every run.
- **As a first pass** it is as accurate as the LLM judge on everything measured, and cheaper and faster. What it lacks is the reason for a pass. Nobody reads those on a normal day, but a reason is how wrong passes were diagnosed before (#87, #120, #147).

It ships as an opt-in experimental option ([#184](https://github.com/hamc/blastproof/issues/184)), [`first_judge`](../configuration.md#first_judge--a-decision-model-before-the-judge-experimental): the model as a setting, the threshold at 0.7 by default, the label check always on, and the probability and the page kept for every decision in `first-judge.jsonl`. It asks the question measured here, from the same code `evals/judge/jev.ts` replays.

The limits: one real app, one acting model, mutants on one demo app.

## Corrections

- The first replay, on 2026-10-13, reported Jev at 34 of 41 with 6 false PASSes. That script passed the raw `{{env.NAME}}` placeholders against a page showing `[redacted NAME]` labels and skipped the label check; the six were all cases the check fails.
- A later version of this page said Jev as a first pass saved nothing, from a 3% token saving. That priced Jev's tokens as the LLM's.

## Measuring a later version

```bash
OPENROUTER_API_KEY=… JEV_MODEL=liquid/d1-ultra npx tsx evals/judge/jev.ts
```

`JEV_MODEL` takes any model on OpenRouter's Decisions API, and `JEV_THRESHOLD` the line a PASS needs (0.5 by default; the option ships at 0.7). It prints each case with its probabilities, marks the cases the label check failed, and ends with the cases right in every sample, the false PASSes and the cost. The reliability benchmark measures the option itself, mutants included:

```bash
npm run build
OPENROUTER_API_KEY=… BLASTPROOF_FIRST_JUDGE_MODEL=liquid/d1-ultra npm run eval:reliability
``` For the LLM judges on the same corpus:

```bash
EVAL_MODELS=anthropic/claude-haiku-4.5,openai/gpt-6-luna EVAL_SAMPLES=3 npm run eval:judge
```
