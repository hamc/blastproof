# Spec: impact-mapping

## ADDED Requirements

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
