# Design: m3b-html-and-test

## Context

M3a produced the machine-readable half of reporting: a priority-weighted score, the `--min-score` gate and JUnit XML. What is missing is the human-readable half, and the command that ties the whole pipeline together. `TestResult` already carries per-step outcomes, the failing step, the reason and a screenshot path, all secret-masked at the executor boundary, so the HTML renderer is another pure function over data that exists. `test` is likewise a composition of `runCommand` and the planner rather than new machinery.

## Goals / Non-Goals

**Goals:**
- One self-contained HTML file per run, openable offline, screenshots inline
- `blastproof test` as the diff-driven one-shot the README promises
- Generated drafts visible in the result without ever deciding it

**Non-Goals:** executing generated drafts, trend history, cross-run comparison, PR comments, the GitHub Action.

## Decisions

### D1: `test` generates drafts but never executes them
The pipeline runs the impacted tests, then generates drafts for affected routes no test covers, then reports and gates. The drafts are printed (and written with `--write`), never run. Executing them would put model-written, unreviewed tests in the merge path: a hallucinated expectation would block a correct pull request, and a credulous one would pass a broken change while looking like coverage. Either failure costs more trust than the automation saves. This also keeps m2b's decision intact — preview by default, human review before a draft becomes part of the suite.

The consequence is deliberate and should be read plainly: `test` does not make an uncovered route safe. It makes the gap visible, with a draft ready to review, and the score continues to describe only what was actually verified (m3a's D1).

Rejected: generating and executing in one pass (the README's original wording); a `--run-generated` opt-in flag (the failure mode is identical, and an opt-in that is unsafe by design should not exist).

### D2: `test` fails when generation fails, but only reviewed tests set the score
Two independent outcomes are folded into the exit code. The score gate reflects executed tests only. A route whose draft could not be generated (page unreachable, malformed model output) is a real failure of the command and exits 1 even when every executed test passed — silently swallowing it would make `test` claim success while having produced nothing for an uncovered route.

### D3: The HTML report is a single self-contained file
Screenshots are read from disk and embedded as base64 `data:` URIs; CSS is inline; there is no JavaScript beyond native `<details>` for collapsing. One file means one artifact to upload, an attachment that survives being emailed, and a report that opens from a local filesystem with no server and no network. The alternative — an HTML file referencing a screenshot directory — is smaller but breaks the moment the report is moved, which is exactly what CI does to it.

A screenshot that cannot be read is skipped with a note rather than failing the report: the report exists to explain a failure, and it must not itself fail while doing so.

### D4: Escaping at one choke point, as with XML
Summaries, steps, reasons and model reasoning all reach the HTML, and all of them are user- or model-authored. Every interpolation goes through `escapeHtml` covering `& < > " '`. This is the same discipline m3a applied to `escapeXml`, for the same reason: the content is not trusted to be markup-safe, and a single missed interpolation turns a report into an injection vector when someone opens it in a browser.

### D5: Score-first layout
The report opens with the score, the gate verdict and the pass/fail counts, because that is the decision the reader came to make. Failures sort above passes; each failed test expands to its failing step, the reason and the screenshot. Passing tests collapse by default — they are context, not content.

### D6: `--html [path]` mirrors `--junit [path]`
Same optional-argument shape, same default location (`<sessionDir>/report.html`), same "written only when asked" rule. Two report flags that behave differently would be a needless thing to remember.

### D7: `CONTRIBUTING.md` states the spec-driven rule up front
The repository rejects code changes without an approved OpenSpec proposal. That rule lives in `AGENTS.md`, which a human contributor has no reason to open. Without it stated where contributors look, the first outside pull request arrives as a well-intentioned patch that cannot be merged as-is — a bad experience the project creates for itself.

## Risks / Trade-offs

- Embedded screenshots inflate the report (~35 KB per failure after base64) → Mitigation: only failures carry screenshots, and a run with many failures has a bigger problem than its report size.
- `test` looks like it closes coverage gaps but does not → Mitigation: D1 is stated in the README and the command's own output distinguishes "executed" from "drafted".
- Drafts printed on every `test` run add noise to CI logs → Mitigation: the summary lists route names; full YAML is printed only without `--write`, and CI uses `--write`.
- Another flag pair (`--junit`, `--html`) to keep aligned → Accepted: D6 keeps them identical in shape, so they stay learnable as one rule.

## Migration Plan

Additive. `run` is unchanged without `--html`; `test` is a new command. No existing behaviour moves.

## Open Questions

(none — the scope of `test` was settled with the user before this proposal)
