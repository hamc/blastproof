# Spec delta: impact-mapping (refuse-an-inverted-routes-map)

## ADDED Requirements

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
