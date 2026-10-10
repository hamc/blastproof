## ADDED Requirements

### Requirement: The action can be listed on the Marketplace
The action's `name` SHALL be one the GitHub Marketplace accepts: it SHALL NOT match a GitHub account it is not published by, so it contains a space, which no account name can. Its `description` SHALL be under 125 characters and SHALL say that the action tests pull requests.

#### Scenario: The listing name cannot collide with an account
- **WHEN** the action's metadata is validated for a Marketplace release
- **THEN** its name contains a space and is not `blastproof`, which an organization not ours holds

### Requirement: The documented pins name the current release
Every `hamc/blastproof@vX.Y.Z` reference and every `version:` input in `docs/ci.md` SHALL equal the version in `package.json`, and a test SHALL fail when one does not.

#### Scenario: A stale CLI pin fails the build
- **WHEN** `docs/ci.md` pins `version: '0.11.0'` while `package.json` is at 0.24.0
- **THEN** the test fails naming the stale pin
