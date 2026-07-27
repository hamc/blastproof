# Tasks: config-env-overrides

## 1. Override layer

- [x] 1.1 `src/config.ts` — `ENV_OVERRIDES` mapping each variable to its config path (`BLASTPROOF_BASE_URL`→`base_url`, `BLASTPROOF_LLM_*`→`llm.*`), exported so tests and docs read from one source
- [x] 1.2 `src/config.ts` — `applyEnvOverrides(data, env)`: merges set, non-empty values into the parsed YAML **before** zod validation, returning the merged object plus the list of fields that were overridden (design D4); pure, `env` injectable
- [x] 1.3 `src/config.ts` — `loadConfig` calls it, and on a validation failure appends which environment variables contributed, so a valid file is not blamed for an env mistake (design D5)
- [x] 1.4 Unit tests: each variable overrides its field; only-one-field leaves the rest defaulted; empty string ignored; absent env behaves exactly as today; invalid provider and invalid URL produce errors naming the variable; `base_url` and `llm.base_url` never cross over

## 2. Precedence

- [x] 2.1 Verify `--url` still wins over `BLASTPROOF_BASE_URL` (flag > env > file, design D3) — `applyUrlOverride` runs after load, so confirm ordering and cover it
- [x] 2.2 Unit tests for the full precedence chain on `base_url`, including flag+env+file all set

## 3. Scaffold and docs

- [x] 3.1 `src/commands/init.ts` — the generated config gains a comment block listing the override variables, so a user discovers them from the file they already have open
- [x] 3.2 README: document the variables, precedence and the CI use case; note that the key itself stays behind `api_key_env` (design D6)

## 4. Workflow

- [x] 4.1 `.github/workflows/dogfood.yml` — replace the config-rewriting step with `env:` entries, making the workflow the worked example of the mechanism (design D7)

## 5. Verification

- [x] 5.1 Locally against `examples/demo-app`: a real run driven entirely by `BLASTPROOF_LLM_*` with the committed config untouched, plus confirmation that an invalid override fails with the variable named
- [x] 5.2 `npm run build && npm run typecheck && npm test` all green
- [x] 5.3 Dogfood workflow dispatched on GitHub and green with the rewrite step gone
