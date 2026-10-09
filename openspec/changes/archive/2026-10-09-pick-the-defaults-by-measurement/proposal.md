# Proposal: pick-the-defaults-by-measurement

## Why

A user who omits `llm.model` gets `gpt-4o-mini` on `openai` and `qwen2.5` on `ollama`. The reliability benchmark (#143) shows both among the worst models tested. On the demo app as it is, `gpt-4o-mini` failed 35 of 40 tests and `qwen2.5` failed all 40.

The benchmark ran 5 samples per case through OpenRouter on 2026-10-08/09. "Right step" counts mutants caught at the step that checks the seeded bug:

| model | false FAIL (/40) | false PASS (/50) | right step (/50) | sign-in failed (/55) |
| --- | --- | --- | --- | --- |
| `gpt-6-luna` (2026-10-07) | 0 | 0 | 50 | 0 |
| `gpt-4o-mini` | 35 | 0 | 12 | 35 |
| `qwen-2.5-7b` | 40 | 0 | 1 | 47 |
| `qwen3.5-9b` | 32 of 33 | 0 of 43 | 4 of 43 | 38 of 48 |
| `gemma-4-26b-a4b` | 40 | 0 | 3 | 47 |
| `gpt-oss-120b` | 26 | 0 | 35 | 13 |
| `gpt-oss-20b` | 2 | 1 | 32 | 10 |
| `qwen3.6-35b-a3b` | 11 | 0 | 43 | 0 |

`gpt-6-luna` is the second reference model of the judge corpus and the README's table. It is also cheaper than `gpt-4o-mini` on OpenRouter ($0.10/$0.50 per million tokens against $0.15/$0.60).

## What Changes

- The `openai` default SHALL be `gpt-6-luna`.
- The `ollama` default SHALL be `gpt-oss:20b`.
- `anthropic` keeps `claude-haiku-4-5`.
- `docs/configuration.md` SHALL publish the table above under "Choosing a model", with the date and the command that reproduces it. It names `qwen3.6-35b-a3b` as the alternative for a machine with more memory, for a user who prefers a red build to a missed bug.
- The `init` template and the provider table in the docs follow.
- `CHANGELOG.md` SHALL say that the defaults changed, and that `ollama pull gpt-oss:20b` is needed before a config without `model` runs.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `llm-providers`: the documented defaults, and the requirement that each one is backed by a published measurement

## Impact

- `src/llm/provider.ts` (`DEFAULT_MODELS`), `src/commands/init.ts`, `docs/configuration.md`, `README.md` (one link), `CHANGELOG.md` at release. No new dependencies.
- A config that sets `llm.model` is unaffected.
- A config that omits it changes model on upgrade, which is the intent.
- On Ollama, the new default needs about 14 GB, where `qwen2.5` needed about 5 GB. A machine that cannot hold it gets the provider's "model not found" message on the first call. That stops the run as incomplete (#125) and is quoted, not summarised.

## Non-goals

- **Changing the Anthropic default.** Haiku has 0 errors in the README's table, and it is the model the judge corpus defends.
- **A per-hardware default.** blastproof does not inspect the machine. The docs give the alternative.
- **Running the benchmark in CI.** It costs money and hours; it stays a release step (`RELEASING.md`).
- **Publishing the open models in the README's table.** The full table belongs beside the setting it informs.
