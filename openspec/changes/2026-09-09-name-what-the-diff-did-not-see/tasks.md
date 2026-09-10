# Tasks: name-what-the-diff-did-not-see

## 1. Reading the working tree

- [ ] 1.1 `src/diff.ts` gains `getUncommittedFiles(cwd)`: sorted repo-relative paths from `simple-git`'s `status()`, covering staged, unstaged, untracked and renamed (design D1)
- [ ] 1.2 It resolves to `[]` rather than throwing when the status cannot be read (design D7)
- [ ] 1.3 `getChangedFiles` keeps its signature and behaviour (design D8)
- [ ] 1.4 Unit tests against a real temporary repository, matching the existing `diff.test.ts` fixtures: a staged file, an unstaged edit, an untracked file, a `.gitignore`d file (absent), a clean tree (empty)

## 2. The warning

- [ ] 2.1 One exported printer takes the uncommitted paths, the diff's paths, the config and the base ref, and writes to **stderr** (design D4)
- [ ] 2.2 It drops files matched by `ignore:` and files already in the diff, and prints nothing when the remainder is empty (design D3)
- [ ] 2.3 It names each remaining file beside the routes `mapImpact` gives it, or states that no glob classified it (design D2)
- [ ] 2.4 It ends with what to do — commit, stash, or run without `--impacted`
- [ ] 2.5 No cap, no truncation (design D6)

## 3. The two call sites

- [ ] 3.1 `run` calls it where it computes the diff (`src/commands/run.ts:587`)
- [ ] 3.2 `plan` calls it where it computes the diff (`src/commands/plan.ts:113`)
- [ ] 3.3 Neither changes an exit code, a selection or a gate — assert `--fail-on-unmapped` still exits 0 on a dirty tree with a clean diff, so the deferred half stays visibly deferred

## 4. Tests

- [ ] 4.1 #99's reproduction: a dirty file mapped to a route is named, with its route, and the run still selects nothing and still exits 0
- [ ] 4.2 A dirty file matched by `ignore:` produces no warning
- [ ] 4.3 A dirty file already in the diff produces no warning
- [ ] 4.4 A dirty file matched by no glob is named as unclassified
- [ ] 4.5 A clean tree produces no output on any path
- [ ] 4.6 `plan --base` warns on the same terms as `run --impacted`
- [ ] 4.7 A `status()` that rejects does not fail the run (design D7)
- [ ] 4.8 Mutation: drop the `ignore:` filter, then the in-diff filter, then the whole printer — record which tests go red for each, and that nothing outside the new block moves

## 5. Verification

- [ ] 5.1 `npm run build`, `npm run typecheck`, `npm test`
- [ ] 5.2 Live: reproduce #99 in this repository exactly as the issue does (`echo "<!-- probe -->" >> examples/demo-app/login.html`), and confirm the warning names the file and `/login`
- [ ] 5.3 Live: the same run on a clean tree prints nothing new, and the demo-app suite is unchanged end to end
- [ ] 5.4 Classify `.tool-versions` in `.blastproof/config.yaml` if the warning shows it is unclassified — dogfooding the response the warning asks for, recorded as evidence the message is actionable

## 6. Documentation

- [ ] 6.1 README: `--impacted` says what it compares and what it therefore does not see
- [ ] 6.2 The enforcement table gains the row, honestly marked: the warning reports, it does not gate
