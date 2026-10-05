# Proposal: replay-the-judge-corpus-on-two-models

## Why

Every change to the judge is verified on one model, `anthropic/claude-haiku-4.5`, the default for the Anthropic provider. A fix tuned to that model can be a fix for that model only. #121's was three pieces of prose that worked only together, measured on Haiku alone. A failure seen only on Haiku cannot be told apart from a defect in our code.

The same 36 cases, 3 samples each, against the judge as released in 0.23.0:

| model | right | wrong | no usable answer |
| --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 99 | 9, all #129's three cases | 0 |
| `openai/gpt-6-luna` | **108** | 0 | 0 |
| `xiaomi/mimo-v2.6-flash` | 102 | 3 | 3 |

#129 is a limit of Haiku, not of the judge's design. On MiMo, `npm run eval:judge` did not finish at all: one answer ran to 65536 tokens without closing its JSON, and the runner crashed on it instead of scoring it.

## What Changes

- `npm run eval:judge` SHALL replay the corpus on every model in `EVAL_MODELS`, a comma-separated list. Each model uses the provider, base URL and key the config resolves. Without the variable it uses the configured model alone, as today.
- The **reference pair** SHALL be `anthropic/claude-haiku-4.5` (the default) and `openai/gpt-6-luna` (another family). `CONTRIBUTING.md` and `AGENTS.md` SHALL ask a judge change to pass on both.
- A **regression** SHALL be a case not marked `knownFailing` that is judged wrong on any model. A `knownFailing` case SHALL be reported as now passing only when it is right on **every** model. The report SHALL list, per case, the models that got it wrong.
- An answer that could not be used (an error that is not a stop of the run) SHALL be scored as a wrong sample and reported as such, never crash the run.

## Capabilities

### New Capabilities

- `judge-corpus`: what the corpus replay runs, what it scores and when it fails

### Modified Capabilities

_None._

## Impact

- New dependencies: **none**
- Affects `evals/judge/run.ts`, `evals/judge/corpus.ts`, `tests/judge-corpus.test.ts`, `CONTRIBUTING.md`, `AGENTS.md`
- No product code and no output of the CLI change. The replay still needs a key and stays out of CI

## Non-goals

- **Changing the default models.** Luna's corpus and dogfood results suggest it, and the Anthropic and OpenAI defaults (`claude-haiku-4-5`, `gpt-4o-mini`) deserve a look. But a default decides what every unconfigured user runs, and that needs live evidence: the Juice Shop probes, more than one suite. It gets its own proposal
- **Per-model `knownFailing` markers.** A case that fails only on one model is reported with that model's name, which is the information a marker would carry
- **#126 and #136**, the output-token ceiling and the uncounted call that the MiMo runaway exposed
