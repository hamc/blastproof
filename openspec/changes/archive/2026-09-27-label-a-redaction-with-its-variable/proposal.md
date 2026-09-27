# Proposal: label-a-redaction-with-its-variable

## Why

Every registered secret is redacted to the same `***`. So once the mask has run, two different values are indistinguishable, and a step that verifies one passes against any other.

#87 reported the milder half: a step asserting on a value that is also in `{{env.*}}` "can never pass". Measured against `examples/demo-app` (OpenRouter, `anthropic/claude-haiku-4.5`), it does pass, and it also passes when it is **false**. The run registered `PROBE_SECRET=HUNTER2` (typed into the promo field) and `OTHER_SECRET=SAVE99` (never on the page):

| step verifies | page shows | verdict |
| --- | --- | --- |
| `Unknown promo code "HUNTER2".` | `Unknown promo code "HUNTER2".` | 3 of 3 PASS |
| `Unknown promo code "SAVE99".` | `Unknown promo code "HUNTER2".` | **3 of 3 PASS** |

The judge sees the step through the mask too, so it compared `"***"` with `"***"` and rightly called it a match. The mask erased the only thing distinguishing a correct page from a wrong one. For a tool that gates merges, a wrong PASS is the worst output available, and this one is deterministic.

## What Changes

- A redaction SHALL name the variable it came from: `[redacted PROBE_SECRET]`, not `***`. Two occurrences of one secret read the same, and two different secrets read differently, so equality survives masking while values do not.
- The value SHALL still never reach a prompt, log or report in any form. Only the variable's name appears, and it is already written in the test files.
- The model and the judge SHALL be told what a label means: the value of that variable, withheld; same label, same value.
- A `fill` or `select` value containing a redaction label SHALL be refused. It is a mask artifact copied from the page, never a real value, and the executor's source check would otherwise admit it because the label is on the page the model read.
- **BREAKING (output):** logs and reports show `[redacted NAME]` where they showed `***`.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: redactions are labelled, described as such to the model and judge, and a label is not a typeable value
- `yaml-test-format`: substituted values appear as their label in logs and reports

## Impact

- New dependencies: **none**
- Affects `src/runner/env.ts` (the replacement), `src/runner/recovery.ts` (the refusal), `src/llm/prompts.ts` (two descriptions), `src/commands/init.ts` (a comment in the scaffold), their tests, README, `docs/auth.md`, `AGENTS.md`
- Fixes #87: a value in `{{env.*}}` becomes assertable by identity, without unmasking it

## Non-goals

- **Not unmasking anything.** The boundary is untouched: every registered value is still replaced, in every form the mask recognises
- **Not a `secrets:`/`data:` split** (#87's other option): it invites marking a password as data, which is the mistake the mask exists to prevent
- **Not hiding variable names.** They are in the test files, the config and the error messages already
