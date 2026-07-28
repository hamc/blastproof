# Design: provider-base-url

## Context

`createModel` (`src/llm/provider.ts`) builds a model instance from the validated `llm` config. The OpenAI and Ollama paths pass `baseURL` through; the Anthropic path does not. Nothing in the schema, the docs or the specs suggests that asymmetry is intentional — `base_url` is a plain optional field on the shared `llmSchema`, and `config-overrides` describes `BLASTPROOF_LLM_BASE_URL` as overriding `llm.base_url` without qualification.

## Goals / Non-Goals

**Goals:** honour a configured endpoint on every provider; write the rule down so the gap cannot reopen; test the combination that was missing.

**Non-Goals:** reachability or compatibility validation, changes to key handling or override names.

## Decisions

### D1: Forward the endpoint rather than reject the combination
Two ways to remove a silent failure: honour the setting, or reject it at validation as unsupported. Honouring it is correct here — the Anthropic client supports a custom endpoint, and the configurations people actually have (a corporate proxy, a compatible gateway, a recording proxy in tests) are legitimate. Rejecting would turn a working intent into a config error for no benefit.

### D2: The spec states the rule for all providers, not a special case for Anthropic
A requirement reading "Anthropic also honours base_url" would leave the next provider in the same silence that produced this bug. The requirement is written as a property of the factory — a configured endpoint is used by whichever provider is selected — so adding a fourth provider inherits the obligation rather than needing a new clause.

### D3: The test covers the combination, not just the line
`tests/provider.test.ts` already exercised `base_url` with `openai` and `ollama`; the untested pair was precisely the broken one. The gap was not a missing assertion but a missing *combination*, which is the kind of hole a coverage percentage hides — every line of the factory was executed, just never with these two values together.

## Risks / Trade-offs

- A user who set `base_url` under `anthropic` without meaning it now reaches a different endpoint → Accepted: the setting had exactly one plausible intent, and silently ignoring configuration is the worse failure.
- A misconfigured endpoint now fails at call time instead of being quietly ignored → Intended; a loud failure beats traffic going somewhere the user did not choose.

## Migration Plan

No migration. Configurations that did not set `base_url` are unaffected.

## Open Questions

(none)
