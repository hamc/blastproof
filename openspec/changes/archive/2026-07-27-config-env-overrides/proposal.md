# Proposal: config-env-overrides

## Why

Validating the CI cycle on GitHub Actions surfaced a real gap: there is no way to point a run at a different LLM provider without editing the committed `.blastproof/config.yaml`. The dogfood workflow has to rewrite that file inside the runner's workspace before every run — a workaround that every consumer of the future GitHub Action would have to copy, because nobody wants to commit their provider choice just to configure CI.

## What Changes

- Read environment overrides when loading config: `BLASTPROOF_BASE_URL`, `BLASTPROOF_LLM_PROVIDER`, `BLASTPROOF_LLM_MODEL`, `BLASTPROOF_LLM_BASE_URL`, `BLASTPROOF_LLM_API_KEY_ENV`
- Overrides are applied before validation, so an invalid value fails with the same actionable error as an invalid config file rather than silently falling back
- Precedence: CLI flag > environment > config file (`--url` keeps winning over `BLASTPROOF_BASE_URL`)
- Applied at the single load point, so `run`, `plan` and any future command inherit them without extra wiring
- The scaffolded config gains comments documenting the overrides
- `.github/workflows/dogfood.yml` drops its config-rewriting step in favour of the env vars

## Capabilities

### New Capabilities

- `config-overrides`: which settings can be overridden from the environment, the variable names, precedence, and validation of override values

### Modified Capabilities

(none — the provider factory keeps receiving a validated config and is unaware of where the values came from)

## Impact

- New dependencies: **none**
- Affects: `src/config.ts` (override layer), `src/commands/init.ts` (template comments), `tests/`, README, `.github/workflows/dogfood.yml`
- Not a breaking change: with no variables set, config loading behaves exactly as today

## Non-goals

- No `--config <path>` flag: the CI need is "same config, different provider", and a second file would force duplicating `base_url` and the whole `routes` map
- No reading the API key itself from a blastproof-prefixed variable; the existing `api_key_env` indirection is preserved so error messages keep naming the variable the user chose
- No overrides for `browser` or `max_retries_per_step` in this slice
- No GitHub Action inputs (M4) — this is the mechanism those inputs will map onto
