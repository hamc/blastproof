# Design: a-secret-used-earlier-in-the-test-counts

## Context

**D5, as it stands.** After the model's verdict, `secretMismatch` in `src/llm/brain.ts` fails a PASS when the judged step names `[redacted X]`, X's label is in neither the snapshot nor the step's record, and the snapshot shows another label. Two conditions keep it off correct steps (`ask-the-judge-about-the-step`, D5):
- **The record:** a step that typed X into a form it then submitted names a secret the page no longer shows.
- **Another label on the page:** a step asserting that X is absent is right on a page showing no label at all.

**What #121 added.** A step whose outcome already holds passes without its action. *"Log in with {{env.DEMO_EMAIL}} and {{env.DEMO_PASSWORD}} and verify the welcome heading"* with the user already signed in therefore passes, and its password was never typed **in this step**. D5's first condition did not foresee that.

**Reproduced** (#141):
- **Stub model.** With a stub answering PASS, `judge()` returns D5's FAIL, deterministically.
- **`examples/demo-app`.** Steps 2 and 3 fill both secrets, step 4 signs in, step 5 is the step above. Wrong FAIL in 5 of 6 runs: Haiku 3/3, Luna 2/3. Luna's one pass came from logging out and signing in again.
- **Juice Shop, `fn-already`.** Same shape, with the secrets filled in steps 2 and 3. D5 failed every run where the agent asserted rather than signed in again.

**The outcome-based fix, measured.** Every corpus case whose step names a secret (#87, #120), 3 samples each, 99 judgments per model, with the judgment's `outcome` field inspected:

| model | outcome keeps the step's label | outcome **swaps** it for the page's | outcome drops it |
| --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 96 | 3 (`120-placeholder-vs-label-final-1`, every sample) | 0 |
| `openai/gpt-6-luna` | 99 | 0 | 0 |

On #141's step, both models' outcome was *"the page shows a welcome heading"*, with no label at all.

## Goals / Non-Goals

**Goals:** a secret used earlier in the test no longer makes D5 fail a correct PASS; #120's case still fails; the check stays on tokens the mask writes, not on prose.

**Non-Goals:** steps in a test signed in by `auth:`, and any change to what the model reads.

## Decisions

### D1: "Accounted for" includes the test's earlier steps
D5 skips a label X found on the page, in the step's record, or among the variables used in the actions of the test's earlier steps. Only actions that succeeded are recorded, so "used" means performed. In #141's tests the password was typed in step 3, and in #120's test `TEST_OTHER` is used nowhere, so the two cases separate cleanly.

What it gives up: a step verifying that the page shows X, when X was typed earlier but the page shows another secret, is no longer caught by D5. It is left to the judge, as it was before D5. That needs a step to type one secret and later verify it on a page showing a different one. Of the cases D5 was built on, none has that shape.

### D2: Names, handed beside the record, never into the prompt
`judge(step, expectation, snapshot, stepHistory, usedEarlier?)`. The fifth argument is the variable names. The executor builds it from the masked records of the steps already finished: `referencedEnvVars` over each recorded action's description, where placeholders survive as `{{env.NAME}}`. It reaches `secretMismatch` only. The model's prompt, and therefore every verdict D5 does not touch, is unchanged.

Not the earlier steps' whole record: the judge would read it as evidence about this step, and `judge-sees-the-record` limited what the judge sees to this step's actions on purpose.

### D3: The corpus can say it too
A case gains an optional `usedEarlier: string[]`, passed through by `runCorpus`. #141's case is captured from the demo-app reproduction, with `["DEMO_EMAIL", "DEMO_PASSWORD"]` and verdict PASS.

## Rejected alternatives

- **Check only the labels in `outcome`**, as #141 proposed. Haiku's rewrite swapped the expected label for the page's in 3 of 99 judgments, the confusion D5 was built to catch. The guarantee would then rest on the model it guards against.
- **Grammar: ignore labels after "with" or "using".** It reads prose, in English only, and "verify the menu shows the email entered with {{env.X}}" defeats it.

## Risks / Trade-offs

- **[The weakening in D1.]** Accepted, for the reason given there.
- **[`auth:` sessions.]** A test signed in by the recipe has no earlier step that typed the secret. A "log in with … and verify" step in such a test still meets D5. That shape is unusual, since such a test is already signed in, and it is left until seen.
