# Proposal: an-account-identifier-is-a-placeholder-too

## Why

`plan` drafted a login test with `{{env.TEST_PASSWORD}}` for the password and the literal `test@example.com` for the email (#100, observed on 0.15.0 and 0.18.0). The model complied exactly. `src/llm/prompts.ts:163` says:

> Never write a real or invented password, token or key.

An email address is none of the three. The rule is a closed list, and the case fell outside it — the project's recurring shape (#57, #60, #72, and #109 last week), each fixed by naming the property instead of extending the list.

It survives review: a reviewer sees a placeholder on the password line and reads the email line as intentional. The suite then signs in as an account that does not exist, and the failure reads as a product defect (#53).

Nothing enforces the rule today either. `findSecretLiterals` looks for a credential word (`password`, `token`, `api key`…) next to a quoted literal. An email matches neither.

## What Changes

- The planner prompt SHALL name the property: any value that identifies an account or a person — an email address, a username, an account or customer number, as well as a password, token or key — is written as a `{{env.*}}` placeholder, never as a real or invented literal. The skill's authoring reference carries the same rule word for word, as its drift guard already requires.
- `plan` SHALL warn when a draft step contains an **email address that does not appear on the page it was drafted from**, naming the route and the step. An address read off the page (a support contact in the footer) is a legitimate thing to verify; one that is not there was supplied by the model. The draft is still written or previewed.
- The authoring reference SHALL say which part is enforced — the email-shaped check — and which is guidance: usernames and account numbers have no shape a check can recognise.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `test-generation`: the placeholder requirement covers account identifiers, and an invented email address is reported

## Impact

- New dependencies: **none**
- Affects `src/llm/prompts.ts` (one rule), `src/planner.ts` (one check), the warning in `src/commands/plan.ts`, `skills/blastproof/references/authoring.md` (the copied rule and the guarantees table), their tests
- No config, no flag, no exit code

## Non-goals

- **Not refusing the draft.** A literal password is refused because it would put a secret in a committed file. A literal email is a wrong test, not a leak, and a draft that is right apart from one line is worth keeping for the person reviewing it
- **Not the runner.** It refuses a fill whose value is in neither the step nor the page; a literal in the step passes that, correctly
- **Not a list of identifier shapes.** Email is the one shape precise enough to check. Phone numbers, usernames and IDs would each be a grammar heuristic, the kind #72 rejected because rewording satisfies it
- **Not #87.** An identifier in `{{env.*}}` becomes unassertable, as any value there does
