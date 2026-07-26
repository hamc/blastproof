# Spec: diff-analysis

## ADDED Requirements

### Requirement: PR diff computation
The system SHALL compute the set of files changed by a PR as `git diff <base>...HEAD` (three-dot, i.e. from the merge-base of `<base>` and `HEAD`) in the current working directory repository, returning repo-relative paths for added, modified, deleted and renamed files.

#### Scenario: Branch changes computed
- **WHEN** the current branch changed `src/cart/discount.ts` and deleted `src/cart/old.ts` relative to `main`
- **THEN** the diff result contains exactly the repo-relative paths of the changed files, including the deleted one

#### Scenario: Invalid base ref
- **WHEN** the user passes `--base nonexistent-ref` and the ref does not exist
- **THEN** the CLI exits with code 2 and an actionable error naming the invalid ref before launching any browser

### Requirement: Diff source locality
The diff SHALL be computed against the repository in the current working directory; no remote fetching or cross-repo access is performed in this slice.

#### Scenario: Not a git repository
- **WHEN** `blastproof run --impacted` executes in a directory that is not inside a git repository
- **THEN** the CLI exits with code 2 and an actionable error message
