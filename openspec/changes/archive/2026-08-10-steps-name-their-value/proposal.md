# Proposal: steps-name-their-value

> **Corrected 2026-08-10.** The "Why" below claims such a step *cannot be carried out*.
> Measured against a real model it is carried out every time, with an invented value,
> and the step **passes**. See the correction at the end of `design.md`, and #57.

## Why

`src/llm/prompts.ts:21` forbids the executor from inventing values: *"A value you type must come from the step, from the page, or from an `{{env.*}}` placeholder."* A step like `fill the note field`, with no value and no page reference, therefore **cannot be carried out** — the runner is required to fail it. Nothing says so until it does, roughly 80 seconds and several model calls into a run, in a `FAIL` whose reason talks about page state. The user concludes the application is broken, or that blastproof is unreliable; both are wrong and neither is recoverable from the output.

The rule is written down in `plannerSystemPrompt` (`src/llm/prompts.ts:161`) and in the README's *Writing tests*, so our own generated drafts obey it. Hand-written and agent-written YAML is unchecked. This is issue #44's sibling rule — the deterministic half, detectable with no browser, no model, no key and no network.

## What Changes

- Detect value-entering steps that name no value, over `steps` and `setup`, from the parsed `TestFile` — pure, deterministic, zero cost.
- Report them to stderr on **every** path `run` can take, from a single unconditional call site, following `route-drift-warning` D5.
- Non-fatal by default. New `--fail-on-authoring` promotes the warning to exit 2, before anything is spent, for teams enforcing in CI.
- The warning shows the fix — the user's own step, rewritten — not a citation of the rule.

## Capabilities

### New Capabilities

- `test-authoring`: deterministic checks over parsed test files that predict a step the runner cannot carry out; detection only, never rewriting

### Modified Capabilities

- `cli-run-command`: report authoring findings to stderr on every path; add `--fail-on-authoring` (exit 2 before browser launch or key check)

## Impact

- New dependencies: **none**
- Affects: `src/runner/authoring.ts` (new, pure), `src/commands/run.ts` (surfacing + flag), `src/cli.ts` (flag on `run` and `test`), `tests/`, README
- Additive: selection semantics and stdout unchanged; default exit codes unchanged unless `--fail-on-authoring` is passed

## Non-goals

- **Not #44's headline rule.** A step that names no outcome is a heuristic over free English and stays open as phase 2. This change closes neither #44 nor #45.
- **English only.** The detection is English grammar in code, so a non-English suite — already runnable today, since nothing requires English — receives no check and no warning that it received none. Scoped out deliberately (design D9), documented in the README, and answered properly by run-time failure classification (#53).
- No `validate` command — this CLI has `init`, `run`, `plan`, `test`; adding a fifth is a separate decision.
- No rewriting, autofix or LLM suggestion — must work keyless.
- No detection inside `parseTestFile` — a step naming no value is valid YAML; failing the parse would make it unrunnable even for users who disagree.
- No single-source refactor of the authoring rules (#45); this change adds a drift guard instead (task 4.1).
