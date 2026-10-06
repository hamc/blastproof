# Proposal: a-secret-used-earlier-in-the-test-counts

## Why

The label check #120 added (`ask-the-judge-about-the-step`, D5) overturns a correct PASS (#141). It fires on a step that names a secret as the means to an outcome that already holds:

```yaml
- fill the password field with {{env.DEMO_PASSWORD}}      # step 3
- click "Sign in" and verify the page shows a welcome heading
- log in with {{env.DEMO_EMAIL}} and {{env.DEMO_PASSWORD}} and verify the page shows a welcome heading
```

The user is already signed in, the heading is on the page, and since #121 the judge passes the last step. D5 then finds `[redacted DEMO_PASSWORD]` in the step, absent from both the page and the step's own record, while the page shows `[redacted DEMO_EMAIL]`. It fails the step. On `examples/demo-app` that was a wrong FAIL in 5 of 6 runs (Haiku 3/3, Luna 2/3), and on Juice Shop in every run where the agent asserted rather than signed in again.

The fix #141 proposed was to check only the labels in the judgment's `outcome`, the step rewritten without its action. Measured on every corpus case naming a secret, 99 rewrites per model, Haiku **swapped the label in 3**. The step expected `TEST_OTHER`, the page showed `TEST_EMAIL`, and the outcome said `TEST_EMAIL`. That is exactly the confusion D5 exists for, so the check cannot rest on the model's rewrite.

## What Changes

- D5 SHALL treat a secret as accounted for when its label appears on the page, in the step's record, **or in the record of an earlier step of the same test**. An earlier step that typed the password is where a later "log in with … and verify …" got it.
- The executor SHALL hand the judgment the names of the variables used in the actions of the test's earlier steps. Names only, taken from the masked record. The model's prompt does not change.
- The judge corpus SHALL gain #141's case, with its earlier-step variables. The corpus format gains an optional field for them.

#120's case is unaffected: its `TEST_OTHER` is never used anywhere in the test, so D5 still fails it.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: the label check accounts for secrets used earlier in the test
- `judge-corpus`: a case may carry the variables used before its step

## Impact

- Dependencies: **none**
- Affects `src/llm/brain.ts` (`judge()` and D5), `src/runner/executor.ts`, `evals/judge/` and their tests
- Only ever turns one of D5's FAILs back into the judge's own verdict

## Non-goals

- **A test signed in by `auth:`**, whose steps never typed the secret. A step there saying "log in with {{env.X}}" still meets D5. The login journey's record is another test's. Rare enough to leave until seen
- **Checking labels in `outcome`**, rejected above
