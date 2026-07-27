# Spec delta: project-init (m4a-npm-release)

## ADDED Requirements

### Requirement: Scaffolded documentation link
The generated configuration SHALL reference the project's canonical repository URL.

#### Scenario: Link resolves
- **WHEN** `blastproof init` scaffolds `.blastproof/config.yaml`
- **THEN** the documentation URL in its header points at the project's real repository
