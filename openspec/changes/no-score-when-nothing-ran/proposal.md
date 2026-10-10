# Proposal: no-score-when-nothing-ran

## Why

A run that stops before any test executes reports a score of **100** (#134). This happens when the provider refuses the first call (#125) or the budget runs out during sign-in. The exit code is 1 and the reports say the run stopped, so the action's own gate holds. But the number a tool reads says otherwise:

```
<property name="score" value="100"/>
<property name="incomplete" value="true"/>
```

The HTML report shows "Run stopped" and then a large **100** above "0 passed · 0 failed · 1 not run". `action.yml` publishes the JUnit property as its `score` output and promises it stays distinguishable from a real result. A later step that reads `outputs.score`, such as a badge, a PR comment or a custom threshold, gets 100 for a run that tested nothing.

The cause is `computeScore`'s `if (total === 0) return 100`. That rule was written for an empty selection, where a diff touched nothing testable and 100 is the right answer. An interrupted run with nothing executed reaches the same line, and nothing there knows the difference.

## What Changes

- A run that is **incomplete and executed no test** SHALL have no score. The console line says the run produced no score. The JUnit report omits the `score` property, the HTML report shows no number, and the action's `score` output is therefore empty. The output already documents "empty" as "no score".
- An incomplete run that executed at least one test keeps today's score over the executed tests, still labelled as not a verdict.
- A complete run with an empty selection keeps scoring 100, as `scoring` requires.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `scoring`: the empty-selection rule applies to a finished run only. An interrupted run with nothing executed has no score.
- `junit-report`, `html-report`: no score shown when the run has none.
- `github-action`: the `score` output is empty for that run.

## Impact

- `src/report/score.ts`, `src/commands/run.ts`, `src/report/junit.ts`, `src/report/html.ts`, with their tests. The action's output description and `docs/ci.md` change by a sentence. `action.yml`'s logic does not change: it already writes an empty output when the property is missing.
- A pipeline that reads `outputs.score` gets an empty string where it got 100. That is the fix, and it is a behaviour change worth a CHANGELOG line.
- Exit codes do not change.

## Non-goals

- **Changing the empty-selection 100.** A diff that affects no test is a finished run with nothing at risk, and gating it would block every docs-only PR.
- **Changing the score of a partly executed incomplete run.** `run-budget` decided to report it over the executed tests, labelled as not a verdict.
- **A `0` instead of no score.** Zero would say the application failed every test, which is as unfounded as 100.
