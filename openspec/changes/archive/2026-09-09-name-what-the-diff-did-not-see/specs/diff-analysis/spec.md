# Spec delta: diff-analysis (name-what-the-diff-did-not-see)

## ADDED Requirements

### Requirement: The diff names the work it excluded
Wherever the system computes a diff for impact selection, it SHALL also inspect the working tree and SHALL report every change the diff did not include — staged, unstaged and untracked alike, `.gitignore` applied.

The report SHALL name each such file together with the routes the `routes:` mapping gives it, or SHALL state that no `routes:` or `ignore:` glob classified it. It SHALL be written as a warning, separate from the impact report.

The report SHALL NOT change what is selected, any exit code, or any gate. A file the config's `ignore:` declares irrelevant SHALL NOT be reported, and neither SHALL a file already present in the diff, whose routes are selected regardless.

Being unable to read the working tree SHALL NOT fail the run; the system reports nothing in that case.

#### Scenario: Uncommitted work is named, with its routes
- **WHEN** a file mapped to `/login` has uncommitted changes and `--impacted` is run against a base whose diff does not contain it
- **THEN** the file and `/login` are named in a warning, and the run still selects only what the diff selected and exits as it would have

#### Scenario: An unclassified uncommitted file is named as unclassified
- **WHEN** an uncommitted file matches neither a `routes:` nor an `ignore:` glob
- **THEN** it is named, and stated to be matched by no glob

#### Scenario: An ignored file is not reported
- **WHEN** an uncommitted file matches an `ignore:` glob
- **THEN** nothing is reported for it, because the user has already declared it cannot affect a page

#### Scenario: A file already in the diff is not reported
- **WHEN** a file appears both in the diff and in the working tree's changes
- **THEN** nothing is reported for it, because its routes are already part of the selection

#### Scenario: A clean working tree is silent
- **WHEN** the working tree has no changes
- **THEN** no warning is produced on any path, which is the case every CI checkout produces

#### Scenario: The gate is unchanged
- **WHEN** `--fail-on-unmapped` runs against a dirty working tree whose diff contains no unclassified file
- **THEN** the exit code is unchanged by this requirement, and the warning is the only new output
