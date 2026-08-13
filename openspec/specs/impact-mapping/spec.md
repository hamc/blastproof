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

### Requirement: Route drift detection
When `.blastproof/config.yaml` declares at least one `routes:` mapping, the system SHALL detect test-declared routes that no `routes:` mapping declares and SHALL expose them as a drift set. Route comparison SHALL be exact equality against the set of routes declared as values across all `routes:` mappings; no normalization (trailing slash, case) SHALL be applied. Drift detection SHALL NOT alter test selection.

#### Scenario: Trailing-slash drift is detected
- **WHEN** config maps a glob to `["/cart"]` and a test declares `routes: ["/cart/"]`
- **THEN** `/cart/` is detected as drift because no mapping declares it

#### Scenario: No drift when routes match exactly
- **WHEN** every test-declared route appears as a value in some `routes:` mapping
- **THEN** no drift is detected

#### Scenario: No drift detection without routes mappings
- **WHEN** config has no `routes:` entries
- **THEN** drift detection does not run, so a suite using routes as metadata is not flagged

#### Scenario: A valid route absent from the diff is not drift
- **WHEN** config maps a glob to `["/cart"]`, a test declares `routes: ["/cart"]`, and the diff affects only `/login`
- **THEN** `/cart` is not drift, because it is declared by a mapping (drift is independent of the current diff)


### Requirement: An inverted routes map is refused
The system SHALL refuse to load a configuration whose `routes:` entries are inverted — a route as the key mapped to file paths as values — rather than accepting a map that can match no changed file. An entry SHALL be treated as inverted only when its key reads as a route (a leading `/` and no glob metacharacter) **and** at least one of its values reads as a file path (a glob metacharacter, or a trailing file extension). Both conditions SHALL be required, so that neither signal alone rejects a valid map. The error SHALL name one offending entry, SHALL state how many others were found, and SHALL show the corrected form built from that entry's own key and value. The system SHALL NOT correct the entry on the user's behalf.

#### Scenario: An inverted entry is refused
- **WHEN** config declares `routes: { "/cart": ["src/cart/**"] }`
- **THEN** loading fails with an actionable error showing `"src/cart/**": ["/cart"]` as the expected form

#### Scenario: The extension does not have to be a known one
- **WHEN** an inverted entry maps a route to a path ending in any file extension, such as `examples/demo-app/login.html`
- **THEN** it is refused, because detection does not depend on a list of recognised source extensions

#### Scenario: A route holding a wildcard is not inverted
- **WHEN** config declares `routes: { "src/products/**": ["/products/*"] }`
- **THEN** the config loads, because the key does not read as a route even though a value contains a wildcard

#### Scenario: An absolute-looking glob is not inverted
- **WHEN** config declares `routes: { "/src/cart/**": ["/cart"] }`
- **THEN** the config loads, because the key carries a glob metacharacter and the values do not read as files

#### Scenario: More than one inverted entry is counted, not listed
- **WHEN** two entries are inverted
- **THEN** the error names one of them and reports that one more was found
