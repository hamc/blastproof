# Design: name-what-the-diff-did-not-see

## Context

One line produces every impacted selection this tool makes (`src/diff.ts:42`):

```ts
const summary = await simpleGit(cwd).diffSummary(['--name-only', `${baseRef}...HEAD`]);
```

Three-dot syntax compares the merge base with `HEAD`. It is the right comparison in CI, where everything is committed, and the wrong one on the machine the change is being written on — where `HEAD` is, by definition, the state before the work being checked.

Three things were read rather than assumed, and each makes the fix smaller:

**The status is already one call away.** `simple-git` is a dependency and `.status()` returns staged, unstaged, untracked and renamed paths, `.gitignore` already applied. Measured on this repository: **13 ms**.

**The classifier is already pure.** `mapImpact(files, routes, ignore)` sorts any list of files into routed / ignored / unclassified with no I/O. Handing it the working tree instead of the diff is free, and it is what lets the warning say *which routes* went unconsidered rather than only which files.

**A non-command module already warns.** `config.ts` prints `warning: unknown config key '<k>' ... so it has no effect` from inside `loadConfig`. Warning about an input that silently does nothing is an established shape here, not a new one.

## Goals / Non-Goals

**Goals:**
- "No affected routes" can never again mean "there was work I did not look at"
- The reader is given enough to decide — the files, and the routes they map to — while the tool decides nothing
- Zero output when there is nothing to say, and zero output in CI

**Non-Goals:** changing what is selected, changing any exit code, a flag, a config key, or a new line in the impact report.

## Decisions

### D1: The predicate is the working tree, and every part of it counts
Staged, unstaged and untracked all count, because `<base>...HEAD` sees none of them. Untracked especially: a brand-new page is the change most likely to be uncovered and the one a diff against `HEAD` is guaranteed to miss.

`.gitignore` is honoured because `git status` honours it, which is the right default — `node_modules/` is not work someone forgot to commit.

### D2: The report names routes, and decides nothing
The warning runs the uncommitted files through `mapImpact` and prints each file beside the routes it maps to, or the fact that no glob classified it:

```
warning: 2 file(s) changed in the working tree are not in the diff against 'main':
  .tool-versions  (matched by no routes: or ignore: glob)
  examples/demo-app/login.html -> /login
Nothing above was considered. Commit or stash them to include them.
```

The wording names no flag, which the first draft of this design got wrong. It said
`so --impacted did not consider them` — accurate under `run`, and false under `plan`,
which has no such flag and computes the diff unconditionally. Both commands are told
the same true thing instead: these paths are not in the diff, and nothing here came
from them.

This is the difference between a warning someone acts on and one they scroll past. `-> /login` tells a reader that a journey they have tests for went untested; the file name alone tells them to go and work that out themselves.

It is also what keeps the second half of #99 genuinely open. The tool reports what *would* have been selected and still selects nothing, so the decision about whether the working tree should count stays with the person, this release and the next.

### D3: Two classes stay silent, because a warning nobody reads is not a warning
**`ignore:` silences it.** The user has already declared that such a file cannot affect a page. Re-reporting it here would contradict our own vocabulary and make the warning fire constantly on the one thing that is already handled.

**A file already in the diff silences it.** Its routes are selected either way; `--impacted` works at route granularity, so an extra uncommitted edit to a file whose routes are already in the selection changes nothing about coverage. Reporting it would train people that the warning does not mean anything.

What survives both filters is exactly the set with a coverage consequence. That matters more than it sounds: this project's own experience (#39, and the user's objection to authoring gates) is that a signal which fires on every run stops being read, and a warning about hidden work is worthless once it is itself invisible.

### D4: It is printed where the diff is computed, at both sites, and the route-drift rule does not transfer
The route-drift design's D5 puts its warning at exactly one call site so that a fourth code path inside `run` cannot silently drop it. That reasoning is about **one command's branches**, and it does not carry to two commands: `run --impacted` and `plan --base` compute the diff independently, and there is no shared branch downstream of both.

So the printer is one exported function called from the two places `getChangedFiles` is called. A future command that computes a diff must call it too — the compiler cannot enforce that, and the honest statement is that this is a convention held by review, one notch weaker than the drift guarantee.

The alternative that *would* be enforceable — widening `getChangedFiles` to return `{ files, uncommitted }` so no caller can hold the diff without holding the caveat — was rejected under D8.

### D5: It prints twice under `test`, and that is accepted
`test` runs `run --impacted` and then `plan`, each computing its own diff, so the warning appears once per phase under its own `=== ... ===` banner.

Measured precedent: `loadConfig` runs **three times** under `test` (`test.ts`, `run.ts`, `plan.ts`), so an unknown-key warning already prints three times today and nobody has minded. That is tolerance rather than design, and it is cited as evidence of the cost being low, not of the shape being ideal.

The positive case is better than the precedent: both phases ignored the same uncommitted work and both phases' conclusions are affected by it, so a reader who scrolls to the Draft section should not have to remember a warning from the Verify section.

### D6: No cap on the list
Neither `printRouteDrift` nor `printAuthoring` truncates, and this one must not either: a warning whose subject is hidden work cannot hide part of it. Someone with three hundred uncommitted files has a problem this output is not the worst part of.

### D7: If the status cannot be read, say nothing
`getChangedFiles` has already succeeded by this point, so the repository exists and the ref resolved; a failing `status()` after that is exotic. It is swallowed. A warning is an accessory to the run and must never be the thing that ends it.

### D8: `getChangedFiles` keeps its signature
Widening the return type would make the caveat impossible for a caller to not have. It would also rewrite the contract of the single most-mocked function in the suite — `getChangedFilesMock.mockResolvedValue([...])` appears in four test files — turning a small fix into a large diff whose risk is concentrated in the tests that protect everything else. Rejected on cost, and the weaker guarantee under D4 is the price paid for it.

## Rejected alternatives

- **Diff with two dots, or against the working tree.** Changes what is selected, which is the second half of #99 and not this change. It would also break CI, where three-dot is correct.
- **`--include-uncommitted`.** A flag that must be switched on cannot fix a silence: nobody who does not know about the hole will pass it.
- **Make it fatal, or teach `--fail-on-unmapped` about it.** Same deferred decision, and a gate that fires on every dirty tree would be turned off within a day.
- **A line in the impact report.** #39 already counts six near-synonyms there for things that were not covered. This goes to stderr with the other warnings, where a diff- and selection-independent fact belongs.

## Risks / Trade-offs

- **It fires often by construction.** Anyone who runs `--impacted` mid-edit sees it, and that is the point — but it is the same wallpaper risk #39 describes. D3 is the mitigation, and the check on whether it worked is whether the warning is ever *empty* on a real working session.
- **It teaches by inconvenience.** On this repository the first run reports `.tool-versions`, unclassified. The correct response is to classify it in `ignore:`, which is exactly the behaviour the warning is trying to produce — and a fair test of whether the message says so clearly enough.
- **The D4 convention can rot.** A fifth command computing a diff could forget the printer. Accepted under D8; the tasks pin the two current sites with tests so a regression at either is caught.

## Migration Plan

None. No config, no flag, no format, no exit code. A clean tree behaves exactly as it does today.

## Open Questions

- **Do the HTML and JUnit reports need it?** #99 asks, and the argument is real — a gate someone reads an hour later has the same problem as one they watched. Left out here because both reports describe a *run*, and this describes the repository the run started from. Worth revisiting if anyone reads a report and is surprised.
- **`--base` pointing at a ref that already contains the work.** Same silence, different cause, and probably the same warning. Not addressed; it needs its own reproduction first.
