## 1. Capture what it generates today

- [x] 1.1 Generate against this repository's own demo app and record the drafts verbatim, so the change is judged against real output rather than an impression.

### Findings

```yaml
summary: User submits a support ticket through the contact form
steps:
  - Navigate to the Support page
  - Enter a subject in the Subject textbox
  - Enter a message in the Message textbox
```

Three bare actions, two naming no value. The executor has refused to invent values since 0.7.0, so `plan` drafts a test `run` is designed not to complete. The `/cart` draft opened with `Navigate to the cart page`, also bare.

## 2. The planner teaches the rule the README teaches

- [x] 2.1 Replace "end with at least one step that verifies an observable outcome" with the rule as the README states it, in the same words (design D1).
- [x] 2.2 A step that supplies a value must write the value, since the executor refuses to invent one.
- [x] 2.4 The planner is told a run starts at `base_url`, not at the route, and must open by navigating there (design D1c — added after verification caught a regression this change introduced).
- [x] 2.5 The first rule, "one action **or** check per step", contradicted the new one and was reworded to "one move per step" (design D1b). `contained-recovery` D1 cited the old phrasing; the argument survives, and reads more directly under the new one.
- [x] 2.3 Do not add a validation pass over the generated prose (design D3, and say why in the spec).

## 3. The rule lives in the spec

- [x] 3.1 `test-generation` gains the requirement, with scenarios covering the outcome and the value.

## 4. Tests

- [x] 4.1 The planner prompt states the rule — pinned so the next edit to that string has something to fail against.
- [x] 4.2 Existing planner tests unchanged: drafts still carry `routes:` set by code, placeholders for secrets, and a valid schema.

## 5. Verification

- [x] 5.1 Same two routes, same app, same model. `/support` went from

  ```yaml
  - Navigate to the Support page
  - Enter a subject in the Subject textbox
  - Enter a message in the Message textbox
  ```

  to

  ```yaml
  - Navigate to /support and verify the heading "Contact support" is shown
  - Fill the Subject textbox with Defective product received
  - Fill the Message textbox with I ordered item XYZ but it arrived broken and non-functional
  - Click the Send message button and verify the confirmation message appears
  ```

  Values written, and the step that commits carries its outcome. Note honestly that the two `Fill` steps still state no outcome of their own — which is right: a fill does not erase its own evidence, and the README's own example does the same. The rule bites where it matters, on the commit.

  **Two routes is a sample, not a proof.** Prompt guidance is the weakest lever available and nothing here guarantees the next generation.
- [x] 5.2 Ran a generated draft, and it **failed the first time** — on the home page, because the draft had no navigation step. That regression was introduced by this change and is written up as design D1c. After telling the planner where a run starts, the regenerated draft passes: **1 passed, Score 100, 11 calls**, no refusal.

  The lesson is the one worth keeping: reading a draft was not enough to judge a change to the generator.
