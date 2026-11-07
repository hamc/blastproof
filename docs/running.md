# Running, selecting and gating

How a diff becomes a merge decision: the commands and their flags, how `--impacted` chooses tests, how the score gates, and the half of blastproof that needs no browser or key. Wiring it into a pipeline is in [Running in CI](./ci.md). Back to the [README](../README.md).

## How it works

<img src="https://raw.githubusercontent.com/hamc/blastproof/main/.github/coverage-flow.svg" width="100%"
     alt="How a diff becomes a merge decision. In CI, unattended: changed files are matched against the routes: and ignore: globs; matched files contribute affected routes, files matching neither are reported as unclassified and fail the run only under --fail-on-unmapped. Tests declaring an affected route are executed and produce a weighted score, which --min-score gates on. An affected route no test declares is reported as a coverage gap and never fails the run. Separately and manually, outside CI: blastproof plan loads such a route in Chromium, makes one model call, and produces a YAML draft you review, edit and run before committing it.">

**The boundary in the middle is the point.** Everything above it runs unattended on every pull request and ends in an exit code. Everything below it is something you choose to run, on your machine, and review before it lands.

A route no test covers is *reported*, never failed — blocking on it would punish you for an incomplete map instead of teaching you to complete it. Turning that report into a test is the manual half, and the draft it produces is not trusted until a person has read it.

## Commands and flags

Common flags — `blastproof <command> --help` has the full list:

| flag | |
| --- | --- |
| `--dry-run` | Print the selection (or, for `plan`, the routes it would draft) and exit. No browser, no API key |
| `--tag` · `--priority` · `--query` | Select a subset of tests |
| `--url <url>` | Override `base_url` for this run (e.g. a PR preview) |
| `--min-score <n>` | Gate on a weighted score instead of all-must-pass |
| `--fail-on-unmapped` | Fail when a changed file matches no `routes:` or `ignore:` glob |
| `--fail-on-authoring` | Fail when a step enters a value but names none (warns by default) |
| `--junit [path]` · `--html [path]` | Write reports |
| `--concurrency <n>` | Run tests at once — [when that is safe](./configuration.md#concurrency--running-tests-at-once) |
| `--write` | `plan` only — persist drafts instead of previewing |
| `--max-llm-calls` · `--max-tokens` · `--max-duration` | [Bound what a run may spend](./configuration.md#budget--bounding-what-a-run-spends) |

Exit codes: **0** pass, **1** the gate failed or the run stopped (its budget, or the model provider refusing a call: `Run incomplete:`), **2** usage or config error.

**Generated drafts are never executed and never affect the score.** An unreviewed model-written test in the merge path fails in two directions: a hallucinated expectation blocks a correct PR, and a credulous one waves a broken change through while looking like coverage. `plan` makes the gap visible with a draft to review; it does not make an uncovered route safe.

## Impact mapping

`--impacted` runs only the tests whose `routes:` intersect the routes your diff can affect, mapped from changed files by globs you maintain in `.blastproof/config.yaml`:

```yaml
routes:
  "src/cart/**": ["/cart", "/checkout"]
ignore:
  - "**/*.md"
```

The key is the file glob and the value is the routes it can affect — the opposite way round from a test file's own `routes:`, which is a plain list of the routes that test covers. Inverted, the map matches nothing at all and every run reports a diff that affected no page, so `blastproof` refuses a map written that way rather than running green against it.

Every changed file lands in one of three buckets: it matches `routes:` and contributes them, matches `ignore:` and is knowingly irrelevant, or **matches neither — nobody has said what it affects**. `--fail-on-unmapped` blocks on that third case, naming the files and both ways to resolve them.

**The diff is `git diff <base>...HEAD`, so it compares commits.** Work you have not committed — edited, staged or untracked — is not in it. That is the right comparison in CI, where everything is committed by the time the workflow runs, and the wrong one on the machine you are writing the change on: a run against a dirty working tree selects from your last commit, not from your editor.

It says so rather than leaving you to notice. Any working-tree change the diff excluded is named on stderr, with the routes it maps to, on `run --impacted` and `plan --base` alike — non-fatal, and it changes no exit code and nothing about what is selected. Files your `ignore:` globs already cover stay silent, and so do files already in the diff, whose routes are selected either way.

**Nothing is ignored by default**, on purpose: a default that guesses on your behalf would hide the first files worth thinking about. The flag is additive — a run can meet `--min-score` and still be blocked here, because "the tests I ran passed" and "something changed that nobody classified" are different claims.

Its limit is worth knowing: it catches files that are *unclassified*, not *misclassified*. A shared module mapped to one route when it can break five still slips through. Impact by import graph is the fix, and blastproof does not do it yet.

## Score and merge gating

Each run scores the percentage of executed test **weight** that passed, weighing 3 at P0, 2 at P1, 1 at P2 — so a failing checkout costs three times a failing tooltip.

```bash
blastproof run                   # any failure exits 1 (strict, the default)
blastproof run --min-score 80    # one failing P2 is tolerated
```

`--min-score` **replaces** the all-must-pass rule rather than adding to it. Only executed tests count: filtered and unrouted tests are neither numerator nor denominator, and a run that executed nothing scores 100, so a docs-only PR is never blocked. JUnit carries the score as a `<property name="score">`, and unrouted tests appear as `<skipped/>` so the coverage gap shows up in CI rather than vanishing. The warnings the run prints (uncommitted work, route drift, a step that names no value) are in both reports too: JUnit counts them in `<property name="warnings">` with their text in `<system-err>`, and the HTML report shows them right after the score.

**The verdict behind that number is pinned, and that is not the same as reproducible.** The model call that decides whether a step passed runs at temperature 0, so the same page and the same expectation are not re-sampled into a different answer — a gate that flips on identical input teaches people to re-run until green, which is worse than no gate. What pinning does not survive: provider-side batching, floating point, and a gateway routing two calls to different providers or quantizations. Expect far less variance, not a guarantee of the same output twice.

The calls that *choose* an action, and the one that drafts a test, are deliberately left free — that latitude is what re-resolves a control after a redesign instead of failing on it.

Wiring this into a pipeline, with the gating patterns worth knowing: [Running in CI](./ci.md). The Action is listed on the GitHub Marketplace as [blastproof e2e AI testing](https://github.com/marketplace/actions/blastproof-e2e-ai-testing).

## Without a browser or a key

Half of blastproof is deterministic and free. These need no model, no browser and no network:

```bash
blastproof run --dry-run                              # what would run
blastproof run --impacted --dry-run                   # + which routes the diff touches
blastproof run --impacted --fail-on-unmapped --dry-run # + gate on unclassified files
blastproof plan --base main --dry-run                 # affected routes no test covers, no key needed
```

They report affected routes, files nobody has classified, and affected routes no test covers — a coverage-gap report with an exit code, useful even on a repo whose suite is Playwright or Cypress.
