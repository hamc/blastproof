## Why

`plan` generates drafts that break the rule the README calls load-bearing.

The README, since 0.10.0, leads its "Writing tests" section with it: **every step says what it should produce**, with the measurement behind it — the same application and suite went from Score 64 to Score 100 on two rewritten steps. The planner's prompt teaches something weaker and older: *"End with at least one step that verifies an observable outcome."*

An outside evaluation noticed the mismatch. Generating against this repository's own demo app confirms it, and it is worse than reported:

```yaml
summary: User submits a support ticket through the contact form
steps:
  - Navigate to the Support page
  - Enter a subject in the Subject textbox
  - Enter a message in the Message textbox
```

Three bare actions in a row. Two of them name no value at all — and the agent's own system prompt has forbidden inventing one since 0.7.0, because inventing values is how a run writes data nobody wrote a test for. So the planner produces steps the executor is then required to refuse.

A tool that drafts the fragile shape and afterwards fails it is teaching the wrong lesson twice: once to the person reading the draft, and once to the agent asked to run it.

## What Changes

- The planner is told the rule the README teaches: a step names what should be true after it, and a step that supplies a value writes the value.
- The rule is written into the `test-generation` spec, so it is a property of generation rather than advice living in one prompt string.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `test-generation`: a generated step states its own outcome and carries any value it needs.

## Non-goals

- **Not validating drafts against the rule in code.** Whether a plain-English step "states an outcome" is not decidable by a parser, and a check that guessed would reject good drafts and pass bad ones. Drafts are reviewed by a person before they join a suite; that review is the check.
- Not changing what `plan` writes, where it writes it, or the provenance header.
- Not touching the executor or the judge. This is about what gets generated, not how it runs.

## Impact

- `src/llm/prompts.ts` — `plannerSystemPrompt`.
- `openspec/specs/test-generation` — the rule becomes a requirement.
- No new npm dependency, no CLI surface change.
