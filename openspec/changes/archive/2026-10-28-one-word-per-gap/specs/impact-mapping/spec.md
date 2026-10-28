## MODIFIED Requirements

### Requirement: Unmapped file reporting
Changed files matching no `routes:` glob SHALL be reported as "unclassified"; unclassified files SHALL NOT fail the run and SHALL NOT contribute affected routes.

#### Scenario: Unclassified files listed
- **WHEN** the diff contains `docs/guide.md` and no glob matches it
- **THEN** the output lists `docs/guide.md` as unclassified and the run continues normally

### Requirement: Deterministic mapping
Impact mapping in this slice SHALL use glob matching only; no LLM calls are made to infer impact.

#### Scenario: Empty mapping configuration
- **WHEN** config has no `routes:` entries
- **THEN** every changed file is reported as unclassified and no routes are affected

### Requirement: Ignore globs
The system SHALL accept an optional `ignore:` glob list in `.blastproof/config.yaml`. A changed file matching an ignore glob SHALL be treated as knowingly irrelevant: it contributes no routes and SHALL NOT be reported as unclassified.

#### Scenario: Documentation is not reported as unclassified
- **WHEN** `ignore:` contains `"**/*.md"` and the diff contains `README.md`
- **THEN** `README.md` is absent from the unclassified files

#### Scenario: Ignored files contribute no routes
- **WHEN** a changed file matches both a `routes:` glob and an `ignore:` glob
- **THEN** the file is treated as ignored and contributes no affected routes

### Requirement: Three-way classification
Each changed file SHALL be classified as mapped to routes, ignored, or unclassified; only files matching neither `routes:` nor `ignore:` SHALL be reported as unclassified.

#### Scenario: A shared module is unclassified
- **WHEN** `src/lib/money.ts` matches no `routes:` glob and no `ignore:` glob
- **THEN** it is reported as unclassified

#### Scenario: No ignore list configured
- **WHEN** no `ignore:` globs are configured
- **THEN** every changed file matching no `routes:` glob is reported as unclassified, as before
