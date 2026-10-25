## Why

`run` prints four warnings, and all four exist only on standard error (#103). Each says the same kind of thing: the coverage this run vouches for may not be the coverage you think it has.

- **Uncommitted work** (#101): files changed in the working tree that `--impacted` did not look at, and the routes they put at risk.
- **Route drift**: a test declares a route no `routes:` mapping declares, so `--impacted` never selects it.
- **Authoring**: a step enters a value but names none, so it fails at run time.
- **A reformatted secret** (#109): the page returned a `{{env.*}}` value in a different form, which was redacted only because the comparison was widened.

The verdict is durable: JUnit XML, the HTML report, the score, the exit code. The caveat on it is not. A CI job hands its reviewer the artifacts, not the scrollback, and in a run of eighty model calls the warning has scrolled away long before the score appears. The reader most exposed to a wrong selection is the one guaranteed not to see the warning about it. `junit.ts` already made this argument once, for unrouted tests ("so the coverage gap shows up in CI instead of only on the terminal"); the warnings never got the same treatment.

## What Changes

- The run collects every warning it prints, as the text it printed.
- The JUnit report carries them: a `warnings` property with their count, and the full text in the suite's `<system-err>`.
- The HTML report carries them in a "Warnings" section right after the score, one block per warning, absent when there are none.
- Nothing changes on the terminal, in the exit code, or in what is selected. No warning becomes fatal.

## Non-goals

- **Making any warning fatal.** `--fail-on-unmapped` and `--fail-on-authoring` already exist for the two that warrant a gate. This change is about durability, not severity.
- **GitHub annotations or an action output.** `::warning` lines and a `warnings` output on the action are a reasonable next step and a separate decision; the JUnit property is what a pipeline can already read.
- **`plan`'s own warning** (an email the page does not show). `plan` writes no report, so there is nowhere for it to go.
- **The impact report's vocabulary** (#39). This change gives the warnings one shape; it does not rename them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `junit-report`: a `warnings` property and the warnings' text in `<system-err>`.
- `html-report`: a Warnings section after the score.

## Impact

- `src/commands/run.ts`, `src/report/uncommitted.ts`: the four printers build their text once, print it unchanged and hand it to the run.
- `src/report/junit.ts`, `src/report/html.ts`: render the warnings.
- No new dependency.
- Documentation: the README's reports section, `docs/` where the JUnit properties are listed, the CHANGELOG.
