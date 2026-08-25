# blastproof CLI

Node >= 20.19. Install with `npm install -g blastproof`, or run it through `npx blastproof`.

## Prerequisites that cause most first-run failures

```
npx playwright install chromium
```

Chromium is not bundled. Without it the first real run fails at browser launch.

A model provider key must be present in the environment variable named by `llm.api_key_env` in `.blastproof/config.yaml` — `ANTHROPIC_API_KEY` by default. Ollama needs none.

Neither is needed for `--dry-run`, which is why it is the right first command.

## `blastproof init`

Scaffolds `.blastproof/` in the current directory: `config.yaml`, a sample test, a login template as `.yaml.example`, and a `.gitignore` covering reports, sessions and captured auth state. Idempotent — it never overwrites a file that exists. No flags.

## `blastproof run`

Executes tests and reports a priority-weighted score.

| flag | effect |
|---|---|
| `--tag <tag>` | only tests carrying this tag; repeatable |
| `--priority <p>` | only tests at this priority — `P0`, `P1` or `P2` |
| `--query <text>` | only tests whose summary matches |
| `--impacted` | only tests whose routes the diff touches |
| `--base <ref>` | git ref the diff is taken against; defaults to `main`, so a repository whose trunk is `master` must pass it |
| `--url <url>` | override `base_url` for this run; the config file is untouched |
| `--dry-run` | resolve selection and print it; no browser, no model call |
| `--min-score <n>` | exit 1 below this score; 0–100 |
| `--junit [path]` | write a JUnit report; the path is optional and defaults to `.blastproof/reports/<session>/junit.xml` |
| `--html [path]` | write a self-contained HTML report; the path is optional and defaults to `.blastproof/reports/<session>/report.html` |
| `--fail-on-unmapped` | exit 1 when a changed file matches neither `routes:` nor `ignore:`. **Requires `--impacted`** — without it the run exits 2 |
| `--fail-on-authoring` | turn authoring warnings into exit 1 |
| `--concurrency <n>` | tests in parallel; **default 1, and raising it is a decision for whoever knows the suite** — these are journeys against one running app, so two tests that write to it can see each other's data |
| `--max-llm-calls <n>` | stop after this many model calls, reported as incomplete |
| `--max-tokens <n>` | stop after this many tokens |
| `--max-duration <seconds>` | stop after this much wall-clock time |

## `blastproof plan`

Generates plain-English YAML drafts for routes, reading the rendered accessibility tree.

| flag | effect |
|---|---|
| `--route <route>` | generate for this route, bypassing the diff; repeatable |
| `--base <ref>` | git ref the diff is taken against; defaults to `main`, so a repository whose trunk is `master` must pass it |
| `--url <url>` | override `base_url` for this run |
| `--write` | persist drafts under `.blastproof/tests/` instead of previewing |
| `--dry-run` | print which routes would generate drafts; no browser, no model call |
| `--max-llm-calls <n>` `--max-tokens <n>` `--max-duration <seconds>` | budget, as above |

Without `--write` nothing is written. `--write` refuses to overwrite an existing file.

`plan` requires `.blastproof/config.yaml` and a working provider — it cannot run before `init`.

**A draft is not a test until someone has read it.** See `authoring.md`.

## `blastproof test`

One command over a diff: it **runs** the tests covering the affected routes first, and then **drafts** tests for the routes nothing covered.

The order matters and so does the boundary: **the drafts it produces are not executed and do not affect the score.** They are a report of what is uncovered, to be read and curated like any other `plan` output. `test` exits 1 when the gate fails, and also when a draft cannot be generated or `--write` meets a file that already exists.

| flag | effect |
|---|---|
| `--base <ref>` | git ref the diff is taken against; defaults to `main`, so a repository whose trunk is `master` must pass it |
| `--url <url>` | override `base_url` for this run |
| `--write` | persist generated drafts |
| `--min-score <n>` | exit 1 below this score; 0–100 |
| `--junit [path]` `--html [path]` | reports; both paths are optional and default under `.blastproof/reports/` |
| `--fail-on-unmapped` | exit 1 on an unclassified changed file |
| `--fail-on-authoring` | turn authoring warnings into exit 1 |
| `--max-llm-calls <n>` `--max-tokens <n>` `--max-duration <seconds>` | budget, as above |

## Score and exit codes

Each test contributes its priority weight: **P0 = 3, P1 = 2, P2 = 1.** The score is the percentage of available weight that passed, so failing one P0 costs more than failing one P2.

Two properties of that number matter before quoting it. Only **executed** tests count — a test that never ran is not in the denominator rather than being a zero. And **an empty selection scores 100**, printed as `Score: 100 (no tests executed)`. A filter that matches nothing therefore produces the most reassuring number the tool can print.

| code | meaning |
|---|---|
| `0` | passed |
| `1` | the gate failed |
| `2` | usage or configuration error |

A budget stop ends the run as **incomplete**, never as a failed test — but it still exits **1**, regardless of `--min-score`. So exit 1 alone does not mean the gate failed; read the summary line before reporting one. `run --dry-run` also exits 1 when `--fail-on-unmapped` finds an unclassified file, which is the check step 8 of the skill runs.

## Without a browser or a key

```
blastproof run --impacted --fail-on-unmapped --dry-run
```

Maps a diff to routes and gates on whether every changed file has been classified. No browser, no model call, no key. It is useful on a repository whose suite is something else entirely.
