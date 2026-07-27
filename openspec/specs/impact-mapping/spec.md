# impact-mapping Specification

## Purpose

Translate changed files into the set of affected routes (the blast radius), deterministically and without LLM calls.

## Requirements

### Requirement: Glob-based route mapping
The system SHALL map each changed file to affected routes using the `routes:` glob→URL-list entries in `.blastproof/config.yaml`, producing a de-duplicated, sorted set of affected routes.

#### Scenario: Files map to routes
- **WHEN** config maps `"src/cart/**"` to `["/cart", "/checkout"]` and the diff contains `src/cart/discount.ts`
- **THEN** the affected route set contains `/cart` and `/checkout`

#### Scenario: Multiple globs, de-duplicated
- **WHEN** two different globs both map to `/checkout` and both match changed files
- **THEN** `/checkout` appears exactly once in the affected route set

### Requirement: Unmapped file reporting
Changed files matching no `routes:` glob SHALL be reported as "unmapped files"; unmapped files SHALL NOT fail the run and SHALL NOT contribute affected routes.

#### Scenario: Unmapped files listed
- **WHEN** the diff contains `docs/guide.md` and no glob matches it
- **THEN** the output lists `docs/guide.md` under unmapped files and the run continues normally

### Requirement: Deterministic mapping
Impact mapping in this slice SHALL use glob matching only; no LLM calls are made to infer impact.

#### Scenario: Empty mapping configuration
- **WHEN** config has no `routes:` entries
- **THEN** every changed file is reported as unmapped and no routes are affected

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
