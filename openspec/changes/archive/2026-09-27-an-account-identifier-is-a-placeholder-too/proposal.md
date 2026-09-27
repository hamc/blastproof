# Proposal: an-account-identifier-is-a-placeholder-too

## Why

`plan` drafted a login test with `{{env.TEST_PASSWORD}}` for the password and the literal `test@example.com` for the email (#100, observed on 0.15.0 and 0.18.0). The model complied exactly. `src/llm/prompts.ts:163` says:

> Never write a real or invented password, token or key.

An email address is none of the three. The rule is a closed list, and the case fell outside it: the project's recurring shape (#57, #60, #72, #109), each fixed by naming the property instead.

It survives review: a reviewer sees a placeholder on the password line and reads the email line as intentional. The suite then signs in as an account that does not exist, and the failure reads as a product defect (#53).

Nothing enforces it either. `findSecretLiterals` refuses a credential word next to a **quoted** literal. An email matches neither, and measuring this change showed worse: six drafts wrote `fill the Password textbox with demo123`, unquoted, and none was refused.

## What Changes

- The planner prompt SHALL name the property: any value that identifies an account or a person — an email address, a username, an account or customer number, as well as a password, token or key — is written as a `{{env.*}}` placeholder, never as a real or invented literal. The skill's authoring reference carries the same rule word for word, as its drift guard already requires.
- `plan` SHALL warn when a draft step contains an **email address that does not appear on the page it was drafted from**, naming the route and the step. An address read off the page (a support contact in the footer) is a legitimate thing to verify; one that is not there was supplied by the model. The draft is still written or previewed.
- The secret check SHALL also refuse a step naming a credential that **enters a value** without a placeholder, quotes or not. "Enters a value" is the definition `run`'s authoring check already uses, not a new grammar.
- The authoring reference SHALL say what is enforced and what is guidance: usernames and account numbers have no shape a check can recognise.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `test-generation`: the placeholder requirement covers account identifiers, and an invented email address is reported

## Impact

- New dependencies: **none**
- Affects `src/llm/prompts.ts` (one rule), `src/planner.ts` (two checks), `src/runner/authoring.ts` (one predicate exported), the warning in `src/commands/plan.ts`, `skills/blastproof/references/authoring.md`, their tests
- No config, no flag, no exit code

## Non-goals

- **Not refusing a draft over an email.** A literal password is refused: it puts a secret in a committed file. A literal email is a wrong test, not a leak, and the draft is worth keeping
- **Not a list of identifier shapes.** Email is the one shape precise enough to check. Phone numbers, usernames and IDs would each be a grammar heuristic, the kind #72 rejected because rewording satisfies it
- **Not #87.** An identifier in `{{env.*}}` becomes unassertable, as any value there does
