# Spec delta: impact-mapping (unmapped-gate)

## ADDED Requirements

### Requirement: Ignore globs
The system SHALL accept an optional `ignore:` glob list in `.blastproof/config.yaml`. A changed file matching an ignore glob SHALL be treated as knowingly irrelevant: it contributes no routes and SHALL NOT be reported as unmapped.

#### Scenario: Documentation is not reported as unmapped
- **WHEN** `ignore:` contains `"**/*.md"` and the diff contains `README.md`
- **THEN** `README.md` is absent from the unmapped files report

#### Scenario: Ignored files contribute no routes
- **WHEN** a changed file matches both a `routes:` glob and an `ignore:` glob
- **THEN** the file is treated as ignored and contributes no affected routes

### Requirement: Three-way classification
Each changed file SHALL be classified as mapped to routes, ignored, or unclassified; only files matching neither `routes:` nor `ignore:` SHALL be reported as unmapped.

#### Scenario: A shared module is unclassified
- **WHEN** `src/lib/money.ts` matches no `routes:` glob and no `ignore:` glob
- **THEN** it is reported as unmapped

#### Scenario: No ignore list configured
- **WHEN** no `ignore:` globs are configured
- **THEN** every changed file matching no `routes:` glob is reported as unmapped, as before
