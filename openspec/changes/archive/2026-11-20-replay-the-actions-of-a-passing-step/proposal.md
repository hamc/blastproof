# Proposal: replay-the-actions-of-a-passing-step

## Why

Every run asks the model for every action of every step. On an application that did not change, each run is a new sample: same cost, same time, and a chance of deciding differently from the last one (#144).

That chance is where the wrong verdicts of the last months came from. Of the issues about a wrong decision, most are the acting model doing something a passing run had not done: typing into a field it had already submitted (#205, and the one false FAIL in `docs/reliability.md`), clicking to make a check true (#139), repeating a commit (#28, #124). Each was closed with a rule, and three of those rules produced the next issue (#141, #164, #205). A rule narrows what the model may do. It does not stop the model from being asked again tomorrow.

The measured rates say the same from the other side. Zero false FAILs in 40 runs bounds the rate below about 9% per test, and a suite of 8 tests at 2% per test is red without cause on about 15% of pull requests.

## What Changes

**A step that passed is replayed, and the model is asked only when the replay stops working.** Off by default (`replay: true`, or `--replay`).

- When a test passes, the runner saves, for each step, the actions that succeeded in it and how the step closed. An action is saved as the role and name the snapshot showed and the value as written, so a `{{env.*}}` placeholder is saved and never its value. Nothing like a selector is stored.
- On the next run, each saved action is the step's next decision in place of a model call. It enters the loop where a model's decision enters, so every check a model's action passes holds for it: the ref is found in a fresh snapshot, the commit-repeat refusal, the source of a typed value, the allowed origins.
- **A check is still judged on the live page, every run.** A step that closed on a judgment is judged again, with the saved claim. A step that closed on `done` with no check closes when its saved actions were all performed and each changed the page where it had before.
- **Anything unexpected ends the replay for that step and the model takes over**, with the step's record as it stands: an element that is not on the page or is there twice, a refusal, an action that fails, a page that did not change where it had, a judgment that fails. That is also how a changed interface heals, and the step's saved actions are replaced when the test passes again.
- The terminal summary and the reports say how many steps were replayed and how many the model resolved.

The saved actions live in `.blastproof/cache/`, one file per test, git-ignored, safe to delete. A CI cache step can carry the directory.

## Capabilities

### New Capabilities

- `action-replay`: what is saved from a passing test, how a saved step is replayed, when a replay ends, and what is reported.

### Modified Capabilities

- `config-overrides`: `replay` from `BLASTPROOF_REPLAY`.
- `cli-run-command`: `--replay` and `--no-replay`, and the summary line.
- `html-report`, `junit-report`: a replayed step is labelled, and the count is a property.
- `project-init`: the scaffolded `.gitignore` ignores `.blastproof/cache/`.

## Impact

- New `src/runner/replay.ts`: the saved form, reading and writing a test's file, and the source of a step's next decision.
- `src/runner/executor.ts`: takes the next decision from the replay when one is live, and reports what each step used.
- `src/commands/run.ts`, `src/cli.ts`, `src/config.ts`: the option, loading before a test and saving after a pass.
- `src/report/html.ts`, `src/report/junit.ts`, `src/commands/init.ts`.
- `evals/reliability/`: a mode that records on the correct app and then runs the mutants from those saved actions.
- No new dependency. No change to a prompt, to the judge or to the judge corpus.
- The dry-run ceiling stays the cost of a run with nothing saved, which is still the upper bound.
- `docs/running.md`, `docs/configuration.md`, `docs/ci.md` (a cache step), `docs/reliability.md` (the measured table), `CHANGELOG.md`, `AGENTS.md`.

## How it is accepted

It ships only if all of these hold, on Haiku 4.5 and `gpt-6-luna`:

1. **No bug is hidden.** The reliability benchmark, with actions saved on the correct app and replayed on every mutant: false PASS stays 0 of 50, and "right step" does not drop.
2. **A warm run asks the model for no action.** On the dogfood suite, the calls of a second run are judgments only.
3. **Fewer wrong FAILs, not more.** The dogfood suite and the notes test in split form, 30 warm runs each: no failure on the correct app.
4. **A changed interface heals.** With one button of the demo app renamed, the test passes, the model resolved that step, and the next run replays it.

## Non-goals

- **On by default.** A gate must not change how it decides on an upgrade. That is a later proposal, with these numbers.
- **Saving a verdict.** The judge is asked on every run. A cached PASS would be a verdict about a page nobody looked at.
- **Feeding past decisions to the model as examples.** A wrong one would repeat itself.
- **Replaying the sign-in steps of `auth:`.** A captured session already covers them.
- **A failure that changes the exit code by classification, or a repair that edits the test file.**
- **Sharing saved actions between branches or machines**, beyond what a CI cache step does with the directory.
