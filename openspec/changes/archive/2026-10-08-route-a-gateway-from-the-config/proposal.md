# Proposal: route-a-gateway-from-the-config

## Why

A gateway like OpenRouter serves an open-weight model through many providers, and some do not honor the JSON schema blastproof sends (#150). Darkbloom answered `qwen3.6-35b-a3b` with `\n\ndone\n\nnull…` instead of an object. Venice ran whitespace to 32k tokens. OpenRouter routes around them per request: `provider.require_parameters`, `provider.ignore`, `provider.order`. blastproof cannot send any of that. The open-model triage could only be measured through a proxy that injected it.

Measured routing, `qwen3.6`, `gpt-oss`, `gemma-4` and `qwen3.5`, on the demo app:

| routing | unusable answers | from Darkbloom or Venice |
| --- | --- | --- |
| default | 4 of 41 | 4 |
| `require_parameters` | 10 of 192 | 8 |
| `require_parameters` + `ignore` both | 76 of 840 | 0 |

The remaining failures are the model's own: an unclosed string or brace, or whitespace to the limit. Since #126 these cost one attempt each, not minutes. `require_parameters` alone did not exclude the two providers, which declare support for the schema and do not honor it.

## What Changes

- `llm.extra_body` SHALL be an object merged into the body of every request, for the OpenAI-compatible providers (`openai`, `ollama`). Setting it with `anthropic` SHALL be a config error that says so.
- The fields blastproof sets SHALL win over `extra_body`: model, messages, response format, output limit, temperature. Routing can be added. Neither the JSON schema nor the output limit (#126) can be weakened.
- `docs/configuration.md` SHALL give the OpenRouter recipe for open-weight models, and say why `ignore` is needed beside `require_parameters`.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `llm-providers`: extra request fields for OpenAI-compatible endpoints

## Impact

- `src/config.ts`, `src/llm/provider.ts`, `docs/configuration.md`. No new dependencies
- Nothing changes for a config without `extra_body`

## Non-goals

- **Repairing an answer in a markdown fence.** It was 2 of about 100 unusable answers. The rest is broken JSON no repair should guess at
- **An environment override.** `extra_body` is an object, and the file is where an object belongs. `BLASTPROOF_LLM_*` stays scalar
- **Naming providers to avoid in the defaults.** Which providers misbehave changes week to week. The docs give the mechanism and the evidence, not a list we would have to maintain
