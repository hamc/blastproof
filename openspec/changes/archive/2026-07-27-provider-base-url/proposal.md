# Proposal: provider-base-url

## Why

Configuring `llm.base_url` with `provider: anthropic` does nothing, silently. The config schema accepts `base_url` for every provider, and the environment-override capability promises `BLASTPROOF_LLM_BASE_URL` maps onto it with no caveat — but the provider factory only forwards it on the OpenAI-compatible path. A user pointing at a corporate proxy or a compatible gateway is routed to the public Anthropic API instead, with no error and no warning. The specs never said `base_url` applies to every provider, and that silence is how this survived a milestone that was reviewed and archived.

## What Changes

- Forward `base_url` to the Anthropic client, as it already is for OpenAI and Ollama
- State in the spec that `base_url` overrides the endpoint for **every** provider that supports one, so the omission cannot be reintroduced as if it were intended
- Cover the previously untested combination: `base_url` with `provider: anthropic`

## Capabilities

### Modified Capabilities

- `llm-providers`: the provider factory honours a configured endpoint for every provider, not only the OpenAI-compatible ones

## Impact

- New dependencies: **none**; `@ai-sdk/anthropic` already accepts `baseURL`
- Affects: `src/llm/provider.ts`, `tests/provider.test.ts`
- Behaviour change: a config that previously reached the public API now reaches the configured endpoint. That is the point, and anyone who set `base_url` under `anthropic` was already expressing that intent

## Non-goals

- No validation that the endpoint is reachable or API-compatible; a wrong URL should fail at call time with the provider's own error rather than through a guess of ours
- No change to `api_key_env` handling or to the `BLASTPROOF_*` override names
