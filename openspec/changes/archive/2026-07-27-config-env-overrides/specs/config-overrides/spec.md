# Spec: config-overrides

## ADDED Requirements

### Requirement: Environment overrides for LLM settings
The system SHALL override `llm.provider`, `llm.model`, `llm.base_url` and `llm.api_key_env` from the environment variables `BLASTPROOF_LLM_PROVIDER`, `BLASTPROOF_LLM_MODEL`, `BLASTPROOF_LLM_BASE_URL` and `BLASTPROOF_LLM_API_KEY_ENV` respectively.

#### Scenario: Provider swapped for a run
- **WHEN** the config file sets `llm.provider: anthropic` and `BLASTPROOF_LLM_PROVIDER=openai` is set
- **THEN** the run resolves the OpenAI provider and the config file is not modified

#### Scenario: Only one field overridden
- **WHEN** only `BLASTPROOF_LLM_PROVIDER` is set
- **THEN** the remaining `llm` settings keep their configured or defaulted values

### Requirement: Environment override for the application URL
The system SHALL override `base_url` from `BLASTPROOF_BASE_URL`, which is distinct from `BLASTPROOF_LLM_BASE_URL` and never affects the provider endpoint.

#### Scenario: App URL overridden
- **WHEN** `BLASTPROOF_BASE_URL=https://preview.example.com` is set
- **THEN** navigation resolves against that URL and `llm.base_url` is untouched

#### Scenario: The two URLs stay separate
- **WHEN** both `BLASTPROOF_BASE_URL` and `BLASTPROOF_LLM_BASE_URL` are set
- **THEN** the first applies to the application under test and the second to the provider endpoint

### Requirement: Precedence
Configuration SHALL resolve in the order CLI flag, then environment variable, then config file.

#### Scenario: Flag beats environment
- **WHEN** `BLASTPROOF_BASE_URL=https://from-env.example.com` is set and the run is given `--url https://from-flag.example.com`
- **THEN** the run uses the flag value

#### Scenario: Environment beats the file
- **WHEN** the config file sets a `base_url` and `BLASTPROOF_BASE_URL` is set to a different URL
- **THEN** the run uses the environment value

#### Scenario: No variables set
- **WHEN** no `BLASTPROOF_*` override variable is set
- **THEN** configuration resolves exactly from the config file

### Requirement: Empty values are ignored
An override variable that is set but empty SHALL be treated as absent.

#### Scenario: Empty variable does not blank a setting
- **WHEN** `BLASTPROOF_LLM_MODEL=` is set and the config file names a model
- **THEN** the configured model is used

### Requirement: Overrides are validated
Override values SHALL be validated exactly as file values are, and an invalid override SHALL fail with an actionable error that names the environment variable responsible.

#### Scenario: Invalid provider rejected
- **WHEN** `BLASTPROOF_LLM_PROVIDER=gemini` is set
- **THEN** the CLI exits with a usage error naming `BLASTPROOF_LLM_PROVIDER` and the accepted providers

#### Scenario: Invalid URL rejected
- **WHEN** `BLASTPROOF_BASE_URL=not-a-url` is set
- **THEN** the CLI exits with a usage error naming `BLASTPROOF_BASE_URL`

#### Scenario: Valid file blamed correctly
- **WHEN** the config file is valid and an override is what makes validation fail
- **THEN** the error attributes the failure to the environment variable rather than to the config file alone

### Requirement: The API key is never read from a blastproof variable
`BLASTPROOF_LLM_API_KEY_ENV` SHALL name the variable that holds the API key; the system SHALL NOT read the key itself from any `BLASTPROOF_*` variable.

#### Scenario: Key indirection preserved
- **WHEN** `BLASTPROOF_LLM_API_KEY_ENV=MY_PROVIDER_KEY` is set and `MY_PROVIDER_KEY` holds the key
- **THEN** the provider is created with that key, and a missing `MY_PROVIDER_KEY` fails with an error naming `MY_PROVIDER_KEY`
