# Design: replay-the-judge-corpus-on-two-models

## Context

**The runner.** `evals/judge/run.ts` builds one brain from `.blastproof/config.yaml` and the `BLASTPROOF_*` overrides, then calls `runCorpus(cases, judge, samples)` from `corpus.ts`. `runCorpus` awaits each `judge()` with no `catch`, so a single thrown error ends the whole replay. The run exits 1 when a case not marked `knownFailing` is wrong in any sample, and reports a marked case that was right in every sample as "now passing".

**The measurements** (`EVAL_SAMPLES=3`, OpenRouter, the judge as released in 0.23.0):

| model | price in / out per M tokens | right / 108 | wrong | unusable |
| --- | --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | $1 / $5 | 99 | 9 (#129 ×3 cases) | 0 |
| `openai/gpt-6-luna` | $0.10 / $0.50 | 108 | 0 | 0 |
| `xiaomi/mimo-v2.6-flash` | $0.14 / $0.28 | 102 | 3 (#129) | 3 |

The MiMo figures come from a scratch runner that caught errors. `npm run eval:judge` itself crashed on the first unusable answer, a 65536-token completion cut off by length (`NoObjectGeneratedError`).

On the dogfood suite, Luna also passed 8 of 8 in 86 calls and 120,132 tokens. Haiku's latest run took 91 calls and 164,009 tokens.

## Goals / Non-Goals

**Goals:** a judge change is verified on two model families; a failure on one model is named as such; one bad answer cannot abort the replay.

**Non-Goals:** the default models, per-model markers, #126, #136.

## Decisions

### D1: `EVAL_MODELS`, on the provider the config already resolves
`EVAL_MODELS=anthropic/claude-haiku-4.5,openai/gpt-6-luna npm run eval:judge`. For each entry, the config's `llm` is copied with `model` replaced, and a brain is built from it. Provider, base URL and key variable stay as resolved. Through a gateway such as OpenRouter that is the whole job. A user with two providers can run the replay twice.

The rejected alternative was a provider-qualified list (`anthropic:claude-haiku-4-5,openai:gpt-6-luna`), each resolving its own key. That is more general, and needs a second key and a second base URL in the environment for anyone who runs it. The gateway case is what this repository uses.

### D2: The reference pair is Haiku and Luna
Haiku because it is the Anthropic default, and so the model an unconfigured user's verdicts come from: a fix that fails there fails for them. Luna because it is another family, cheaper per call, and right on every case. A prose fix that holds on both is less likely to be a quirk of one. MiMo is not in the pair: an unusable answer in 3 of 108 would turn into noise in every replay.

### D3: Scoring across models
- **Regression:** a case not marked `knownFailing` that is wrong in any sample on any model. The exit is 1.
- **Now passing:** a `knownFailing` case that is right in every sample on **every** model. #129's cases are right on Luna and wrong on Haiku, and they are still open. Reporting them as now passing would invite removing a marker for a bug that still reaches the default model.
- **The report:** one line per case, with right/samples per model, and the names of the models that got it wrong.

### D4: An unusable answer is a wrong sample
`runCorpus` catches an error from `judge()` and scores the sample as wrong, with `error: <message>` as its reason. A `RunStoppedError` (#125) still ends the replay: a refused key or an exhausted balance makes every later sample meaningless. This is the corpus's own version of the rule `count-a-malformed-judgment-as-an-attempt` applied to the executor.

## Risks / Trade-offs

- **[Twice the cost per replay.]** Luna's share is about a tenth of Haiku's.
- **[A model can be retired or change behind its id.]** The pair is named in the docs and can be changed in one place. A replay on a model that no longer exists fails on the refusal, loudly.
- **[One measurement.]** Luna's 108/108 is one replay of 36 cases. The pair is a check, not a ranking.
