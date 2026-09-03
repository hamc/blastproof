# Running in CI

blastproof is built for the pull request: read the diff, run what the diff can
break, score it, and exit non-zero when the score is not good enough.

- [GitHub Actions](#github-actions)
- [`fetch-depth: 0` is not optional](#fetch-depth-0-is-not-optional)
- [Pinning](#pinning)
- [Other CI systems](#other-ci-systems)
- [Reports](#reports)
- [Gating patterns](#gating-patterns)
- [The half that needs no key](#the-half-that-needs-no-key)

## GitHub Actions

```yaml
name: blastproof
on: pull_request

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # required — the diff needs a merge-base

      - run: npm start &          # however your app boots

      - uses: hamc/blastproof@v0.17.0
        with:
          version: '0.11.0'       # pin both when this gates merges
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          base: ${{ github.event.pull_request.base.ref }}
          min-score: '80'
          fail-on-unmapped: 'true'
```

A non-zero exit blocks the merge. The full input list is in
[`action.yml`](../action.yml).

### Outputs

| output | |
| --- | --- |
| `score` | 0–100, empty when no report was produced |

Empty rather than zero is deliberate: a run that produced no report has no
score, and a downstream step comparing against `0` would read "everything
failed" from "nothing ran".

```yaml
      - id: bp
        uses: hamc/blastproof@v0.17.0
        with:
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}

      - if: steps.bp.outputs.score != ''
        run: echo "scored ${{ steps.bp.outputs.score }}"
```

## `fetch-depth: 0` is not optional

`actions/checkout` is shallow by default, and a shallow clone has no merge-base
— so there is no diff to map to routes.

The action detects this and **fails immediately with a message naming the
fix**, rather than letting it surface as an opaque git error somewhere in the
middle of a run. This is covered by the repository's own `Action self-test`
workflow, which asserts that a shallow checkout is rejected.

## Pinning

Two versions are in play, and they are independent:

- the **action** ref (`hamc/blastproof@v0.17.0`) — the wrapper
- the **`version`** input — which blastproof release the wrapper installs from
  npm, defaulting to `latest`

Pin both when the result gates merges. `latest` means a release published on a
Tuesday can change how your Wednesday pull requests are judged, which is exactly
the kind of surprise a merge gate should not produce.

Published releases carry npm provenance, so a pinned version is attestable back
to the commit and workflow that built it.

## Other CI systems

There is no wrapper for GitLab, CircleCI or Jenkins, and none is needed — it is
an npm package with an exit code.

```bash
npm install -g blastproof@0.11.0
npx playwright install --with-deps chromium

npm start &
# wait for the app however your setup does it

blastproof run \
  --impacted --base "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" \
  --min-score 80 \
  --fail-on-unmapped \
  --junit results.xml
```

Make sure the clone is deep enough to have a merge-base. On GitLab that means
setting `GIT_DEPTH: 0`; most systems have an equivalent.

Exit codes: **0** pass, **1** the gate failed, **2** usage or configuration
error. A `2` is worth surfacing differently from a `1` in your pipeline —
one means the application under review has a problem, the other means the
pipeline does.

## Reports

```bash
blastproof run --junit results.xml --html report.html
```

**JUnit** is what CI systems parse into a test summary. Beyond the usual cases
it carries:

| | |
| --- | --- |
| `<property name="score">` | the weighted score |
| `<property name="llm_calls">` · `llm_tokens` | what the run spent |
| `<skipped/>` on unrouted tests | tests `--impacted` could not select |

Unrouted tests appear as skipped rather than being omitted entirely, so the
coverage gap shows up in the CI summary instead of vanishing silently.

**HTML** is the one to attach as an artifact when a run fails. It carries the
per-step trace and links the failure screenshot.

```yaml
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: blastproof-report
          path: |
            report.html
            .blastproof/reports/
```

`if: always()` matters — the run you most want the report from is the one that
just failed the job.

## Gating patterns

**Strict.** Any failure blocks. The default, and the right starting point.

```bash
blastproof run --impacted --base main
```

**Weighted.** Tolerate a low-priority failure, never a critical one. With P0
weighing 3 and P2 weighing 1, `--min-score 80` on a suite of mixed priorities
lets one P2 through and stops any P0.

```bash
blastproof run --impacted --base main --min-score 80
```

**Coverage as well as correctness.** `--fail-on-unmapped` is additive rather
than part of the score: a run can meet `--min-score` and still be blocked here,
because *"the tests I ran passed"* and *"something changed that nobody
classified"* are different claims about a pull request.

```bash
blastproof run --impacted --base main --min-score 80 --fail-on-unmapped
```

## The half that needs no key

Worth its own job, because it costs nothing and answers a question no other
check does:

```yaml
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: npx blastproof run --impacted --base main --fail-on-unmapped --dry-run
```

No browser, no API key, no network. It reports which routes the diff affects,
which changed files nobody has classified, and which affected routes no test
covers — a coverage-gap gate that is useful even on a repository whose suite is
Playwright or Cypress and which never runs an agentic test at all.
