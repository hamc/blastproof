# Design: config-env-overrides

## Context

`loadConfig` reads `.blastproof/config.yaml` and validates it with zod; the resolved object flows into the provider factory, the runner and the planner. The only value that can be changed from outside the file today is `base_url`, via the `--url` flag (m2a design D6). Everything about the LLM — provider, model, endpoint, which variable holds the key — is file-only. Proving the CI cycle on GitHub Actions exposed the consequence: the dogfood workflow rewrites the committed config in the runner's workspace before it can run, and every consumer of the M4 Action would inherit that workaround.

## Goals / Non-Goals

**Goals:**
- Override `base_url` and the `llm.*` settings from the environment
- One choke point, so every present and future command inherits it
- Invalid override values fail loudly, never silently
- Remove the config-rewriting step from the dogfood workflow

**Non-Goals:** a `--config` flag, overrides for `browser`/`max_retries_per_step`/`routes`, reading the API key itself from a blastproof variable, GitHub Action inputs.

## Decisions

### D1: Environment variables, not a second config file
The CI need is narrow and specific: keep everything (`base_url`, the whole `routes` map, browser settings) and change only the provider. A `--config <path>` flag would force duplicating that entire file to vary one section, and the duplicate would drift from the committed one — the `routes` map especially, which is the thing impact analysis depends on. Environment variables express "same config, one field different" exactly, add no CLI surface to `run`/`plan`/future commands, and map one-to-one onto the Action inputs M4 will need. Rejected alternatives: `--config` (duplication, drift); per-field CLI flags (surface growth on every command, verbose in CI invocations).

### D2: `BLASTPROOF_` prefix, and `base_url` vs `llm.base_url` disambiguated by name
Two different URLs live in this config: `base_url` is the application under test, `llm.base_url` is the provider endpoint. Overriding the wrong one silently would point the browser at an LLM gateway or the LLM at the demo app, and both failures would be baffling. The names keep them apart by construction:

| variable | overrides |
| --- | --- |
| `BLASTPROOF_BASE_URL` | `base_url` (the app under test) |
| `BLASTPROOF_LLM_PROVIDER` | `llm.provider` |
| `BLASTPROOF_LLM_MODEL` | `llm.model` |
| `BLASTPROOF_LLM_BASE_URL` | `llm.base_url` (the provider endpoint) |
| `BLASTPROOF_LLM_API_KEY_ENV` | `llm.api_key_env` |

The `BLASTPROOF_LLM_` prefix mirrors the `llm.` nesting, so the mapping is guessable from the config file alone.

### D3: Precedence is CLI flag > environment > config file
The environment is ambient and the flag is a deliberate act on this invocation, so the flag wins — `--url` keeps overriding `BLASTPROOF_BASE_URL`, preserving m2a's D6 contract exactly. The file is the fallback, which keeps a checkout with no environment behaving as it does today. Only variables that are set and non-empty override: an empty string is treated as absent, so `FOO=` in a CI matrix does not blank out a configured value.

### D4: Applied inside `loadConfig`, before validation
The override layer merges into the parsed YAML *before* zod runs, rather than patching the validated object afterwards. Two consequences, both wanted: an invalid override (`BLASTPROOF_LLM_PROVIDER=gemini`, a non-URL in `BLASTPROOF_BASE_URL`) fails with the same actionable `ConfigError` as an invalid file, naming the offending field; and defaulting still works, so overriding only the provider leaves model defaulting intact. Patching afterwards would let a bad override slip past validation into the provider factory and fail later with a worse message.

### D5: The error must say the value came from the environment
When an override is what makes validation fail, the message names the variable responsible. Otherwise the user reads "invalid .blastproof/config.yaml: llm.provider" while staring at a file that is perfectly valid — the worst kind of error message. The loader tracks which fields were overridden and appends that context.

### D6: The API key stays behind `api_key_env`
`BLASTPROOF_LLM_API_KEY_ENV` overrides *which variable* holds the key, never the key itself. Accepting a key directly in a blastproof-prefixed variable would add a second, general-purpose home for a secret while removing nothing: the key has to live in some variable either way. Keeping the indirection preserves the existing `MissingApiKeyError` message, which names the variable the user actually chose.

### D7: The dogfood workflow drops its rewrite step
The workflow's `node --input-type=module -e "..."` step exists only because this gap existed. It is replaced by four `env:` entries, which is also the shape the M4 Action inputs will take — so the workflow becomes the working example of the mechanism rather than a workaround around its absence.

## Risks / Trade-offs

- Ambient variables make runs harder to reproduce ("why is it using a different model?") → Mitigation: the run header already prints the resolved provider and model, so the effective values are always on screen.
- A stale `BLASTPROOF_*` variable exported in a shell silently changes later runs → Mitigation: same header; and precedence means an explicit flag always wins.
- Variable names become a compatibility surface once the M4 Action maps onto them → Accepted deliberately: settling them now, before publishing, is the point of doing this slice first.

## Migration Plan

Purely additive. With no variables set, `loadConfig` behaves exactly as today, so existing projects and the committed config are unaffected.

## Open Questions

(none — the mechanism was chosen with the user; field scope and precedence follow from it)
