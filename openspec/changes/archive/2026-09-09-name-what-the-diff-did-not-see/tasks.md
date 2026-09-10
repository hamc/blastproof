# Tasks: name-what-the-diff-did-not-see

## 1. Reading the working tree

- [x] 1.1 `src/diff.ts` gains `getUncommittedFiles(cwd)`: sorted repo-relative paths from `simple-git`'s `status()`, covering staged, unstaged, untracked and renamed (design D1)
- [x] 1.2 It resolves to `[]` rather than throwing when the status cannot be read (design D7)
- [x] 1.3 `getChangedFiles` keeps its signature and behaviour (design D8)
- [x] 1.4 Unit tests against a real temporary repository, matching the existing `diff.test.ts` fixtures: a staged file, an unstaged edit, an untracked file, a `.gitignore`d file (absent), a clean tree (empty)
- [x] 1.5 A rename contributes **both** of its paths. Measured, not assumed: `status.files` carries the pre-rename path in a `from` field and nowhere else, and a page that moved changes what covers the route it left as much as the route it arrived at

## 2. The warning

- [x] 2.1 One exported printer in `src/report/uncommitted.ts` takes the uncommitted paths, the diff's paths, the config and the base ref, and writes to **stderr** (design D4)
- [x] 2.2 It drops files matched by `ignore:` and files already in the diff, and prints nothing when the remainder is empty (design D3)
- [x] 2.3 It names each remaining file beside the routes `mapImpact` gives it, or states that no glob classified it (design D2)
- [x] 2.4 It ends with what to do
- [x] 2.5 No cap, no truncation (design D6)
- [x] 2.6 It takes `Pick<BlastproofConfig, 'routes' | 'ignore'>`, not the whole config — the signature says what it actually reads, and the unit tests need no fixture file

## 3. The two call sites

- [x] 3.1 `run` calls it where it computes the diff, inside the `if (impacted)` branch
- [x] 3.2 `plan` calls it where it computes the diff, on the diff-driven path only — with explicit `--route` no diff exists, so there is nothing it could have missed
- [x] 3.3 Neither changes an exit code, a selection or a gate: `--fail-on-unmapped` still exits 0 on a dirty tree with a clean diff, pinned by a test, so the deferred half stays visibly deferred

## 4. Tests

- [x] 4.1 #99's reproduction: a dirty file mapped to a route is named, with its route, and the run still selects nothing and still exits 0
- [x] 4.2 A dirty file matched by `ignore:` produces no warning
- [x] 4.3 A dirty file already in the diff produces no warning
- [x] 4.4 A dirty file matched by no glob is named as unclassified
- [x] 4.5 A clean tree produces no output on any path
- [x] 4.6 `plan --base` warns on the same terms as `run --impacted`
- [x] 4.7 A `status()` that cannot be read does not fail the run (design D7) — covered by the no-repository case
- [x] 4.8 Mutation, three of them, each restored before the next:
  - drop the `ignore:` filter → **2 red**, both in the new unit block
  - drop the already-in-diff filter → **3 red**, including the path-separator case
  - make the printer a no-op → **8 red**, spanning the unit block and both call sites
  - nothing outside the new blocks moved in any of the three

## 5. Verification

- [x] 5.1 `npm run build`, `npm run typecheck`, `npm test` — **599 passed, 35 files** (was 579 / 34)
- [x] 5.2 Live, in this repository: `echo "<!-- probe -->" >> examples/demo-app/login.html`, then `run --impacted --base main --dry-run` names the file and `/login`, and `plan --base main --dry-run` prints the same warning on the same tree
- [x] 5.3 Live, clean tree: nothing new is printed. **No agentic run was made**, and that is a deliberate limit rather than a claim: this change adds one stderr write on the diff path and cannot reach the executor, the browser or the model. The scheduled dogfood on `main` covers the end-to-end path at release time, as it does for every change
- [x] 5.4 The warning's first act against this repository was to report `.tool-versions` as unclassified. Classified it in `.blastproof/config.yaml` with the reason, and re-ran: the warning drops to the one file the probe actually changed. The message asked for a response and got the right one

## 6. Documentation

- [x] 6.1 README, *Impact mapping*: what `--impacted` compares, what it therefore does not see, and that it now says so on both commands
- [x] 6.2 **Deviation, recorded rather than done.** The planned row in the authoring enforcement table is wrong: that table is about rules for writing a *test step*, and this is a property of the diff. A row there would be the seventh near-synonym problem (#39) moved into a second document. The README paragraph is the whole documentation change

## 7. What the design got wrong, and when

- [x] 7.1 D2's draft message said `so --impacted did not consider them`. Accurate under `run`, false under `plan`, which has no such flag and computes the diff unconditionally. Found by wiring the second call site, not by review. The design was corrected first and the code written to it, per CONTRIBUTING
