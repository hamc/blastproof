# Proposal: refuse-an-invented-value

## Why

`src/llm/prompts.ts:22` tells the executor: *"Never invent a value. A value you type must come from the step, from the page, or from an `{{env.*}}` placeholder."* Nothing enforces it.

Measured against `examples/demo-app` with a real model, a test whose only step is `fill the note field`:

```
1 → fill textbox "Note" [This is a test note.]  → PASS  Score: 100
2 → fill textbox "Note" [This is a test note.]  → PASS  Score: 100
3 → fill textbox "Note" [This is a new note]    → PASS  Score: 100
```

Three runs, three inventions, three passes, and the value differs between runs. A green test over an input nobody wrote is the false negative this project exists to remove: the suite reports coverage of a journey it never specified, and nothing in the report says the value was fabricated, because nothing knows.

0.12.0 shipped a static warning for the authoring shape, and 0.12.1 corrected that warning to admit the runner carries such a step out anyway. The tool currently ships a message describing a live false negative and naming this issue as the fix. Issue #57.

## What Changes

The executor refuses a `fill` or `select` whose value is traceable to none of the three permitted sources, at the same choke point that already refuses a repeated commit. The action is not performed, the model is told which sources it may draw from, and the step fails honestly on the existing retry budget if the model insists.

## Capabilities

### Modified Capabilities

- `agentic-execution`: a typed value must be traceable to the step, to the snapshot the model was shown, or to an `{{env.*}}` placeholder; an untraceable value is refused rather than performed

## Impact

- New dependencies: **none**
- Affects: `src/runner/recovery.ts` (the refusal), `src/runner/executor.ts` (one call site), `tests/`, README, `docs/`
- **Not additive**: a suite that passed by fabricating a value now fails. That is the defect being closed, but it is a behaviour change and makes this a minor bump

## Non-goals

- No change to `press` or `navigate`. A `press` value is a key name (`Enter`), not free text, and `navigate` is already bounded by `allowed_origins`
- No model call to decide whether a value is derivable — that asks the model to police itself, and costs a call per fill
- No new flag. The repeated-commit refusal has none either; a correctness guarantee that must be switched on is guidance again
- No change to the static authoring warning, which keeps its own job: predicting this before the run, with no key
- No semantic matching (synonyms, reformatted numbers, values assembled from two fields). Stated as a known limit rather than half-solved
