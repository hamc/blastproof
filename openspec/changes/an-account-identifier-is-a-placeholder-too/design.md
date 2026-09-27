# Design: an-account-identifier-is-a-placeholder-too

## Context

Three things read rather than assumed:

**The rule exists twice, and a test holds the copies together.** `plannerSystemPrompt()` (`src/llm/prompts.ts:163`) and `skills/blastproof/references/authoring.md:20` carry the same line, and `tests/skill-manifest.test.ts` compares the two rule sets by set equality. Changing the prompt without the skill fails the suite, which is the point.

**The existing check is a keyword heuristic, not a value comparison.** #100 describes `findSecretLiterals` as catching "a generated value that matches a masked environment value". It does not. It matches a credential word (`password|passwd|api key|token|secret|credential`) next to a quoted literal with no `{{env.`, and refuses the draft. An email address carries neither the word nor, in the observed step, the quotes.

**The quotes are what the password check hinges on, and a model does not quote.** Measuring this change against the demo's login page produced six drafts reading `Fill the Password textbox with demo123`. `QUOTED_LITERAL` did not match any of them, so none was refused, although the credential word was there and no placeholder was.

**The codebase already defines "a step that enters a value".** `src/runner/authoring.ts` (`detectMissingValues`, design steps-name-their-value) recognises a leading value verb (`fill`, `enter`, `type`, `input`, `set`) and asks whether the step names a value, by a connector word or symbol. It is tested, English-only by its own documentation, and it is the definition `run --fail-on-authoring` already acts on.

**The planner already holds the snapshot it would need.** `generateForRoute` takes one masked snapshot, sends it to the model and discards it. The draft is the only thing returned, and `plan` renders it field by field (`renderTestYaml`), so an extra property on the returned object never reaches the YAML.

## Goals / Non-Goals

**Goals:**
- The rule names the property, so the observed case and its neighbours are covered by the instruction
- The one neighbour with a precise shape — an email address — is checked, with a condition that separates an invented value from one read off the page
- The documentation says which part is checked and which is not

**Non-Goals:** refusing a draft over an email, the runner, other identifier shapes, and #87.

## Decisions

### D1: The rule, word for word
```
- If a step needs a credential, or any value that identifies an account or a person — an email address, a username, an account or customer number — write it as a placeholder like {{env.TEST_EMAIL}} or {{env.TEST_PASSWORD}}. Never write a real or invented one.
```
The property leads and the examples follow. The examples are there because a model follows a concrete one more reliably than an abstraction. They are introduced as instances of the property, so a value missing from them is still covered by the sentence that precedes them. The last clause ("never a real or invented one") refers back to the property, not to the examples.

The skill's `authoring.md` gets the same line, byte for byte.

### D2: The check is "an email address the page does not show"
A draft step is reported when it contains a string matching an email address and that string is not in the snapshot the draft was generated from, compared case-insensitively. This is the same test the runner applies to a filled value: a value in neither the step nor the page was supplied by the model. Here it is applied one step earlier, to the draft.

The pattern is deliberately plain: a local part, `@`, a domain with at least one dot. It is not an RFC 5322 parser, because the question is "does this step carry an address", not "is this address valid".

The comparison is made against the **masked** snapshot. An address that is also a registered secret shows as `***` there, so a step carrying it literally is reported, which is correct: the step should have used the placeholder.

Alternatives:
- **Add `email|username` to `CREDENTIAL_WORD`.** That keeps the existing heuristic and inherits its weakness: it needs the word and the quotes, and "fill the login field with test@example.com" has neither. It is also exactly the list-extension this change exists to stop.
- **Refuse the draft**, as `findSecretLiterals` does. See D3.
- **Rewrite the step to `{{env.TEST_EMAIL}}` automatically.** That invents a variable name nobody declared, the thing #66 refused for the runner, and hides the problem from the person reviewing the draft.

### D3: Report, do not refuse
A literal password in a committed file is a leak, so refusing it is proportionate. A literal email is a wrong test: the draft is otherwise right, and the person reviewing it is exactly who should fix one line. Refusing would discard a paid draft over it, which #91 already argued against for a smaller reason.

The report goes to stderr, under the route, before the draft is written or previewed, so it sits next to the file the reviewer is about to open:

```
  warning: step 2 writes an email address the page does not show (test@example.com).
    If it is the account the test signs in as, use a placeholder like {{env.TEST_EMAIL}}.
```

The address is printed. Unlike a secret, it came from the model, not from the environment, and the reviewer needs to see which line it is.

### D4: The finding travels with the draft
`generateForRoute` attaches the finding to the object it returns (`unsourcedEmails`, one entry per step and address). `renderTestYaml` selects fields explicitly, so the property never reaches the file. The alternative, a second function that re-takes the snapshot, would compare the draft against a page that might have changed.

### D5: A secret is refused whether or not it is quoted
`findSecretLiterals` keeps its credential word and its "no `{{env.`" condition, and accepts either of two value signals instead of one:

```ts
CREDENTIAL_WORD.test(step) && !step.includes('{{env.') &&
  (QUOTED_LITERAL.test(step) || entersNamedValue(step))
```

`entersNamedValue` is exported from `authoring.ts` as the positive half of the predicate the authoring check already uses: a leading value verb, and a value named. Nothing flagged today stops being flagged, because the quoted branch is unchanged. What is added is the case measured: an entry step naming a credential field and supplying a bare value.

It still refuses, unlike the email check (D3). A password in a draft is a secret on its way to a committed file, which is the case refusal was built for.

Alternatives:
- **Drop the quote requirement and flag any credential word without a placeholder.** It refuses "verify the password field is visible", which the existing comment exists to protect.
- **A new, planner-local grammar for "the value after *with*".** A second definition of the same idea, drifting from the first. Reusing the authoring check's means one definition, and one set of tests that already pins its edges (phrasal `fill in`, `set` against `setup`, verbs used as nouns).

### D6: The guarantees table says what is checked
`authoring.md`'s "What is enforced" table gains a row: an account identifier is a placeholder. **Reported by `plan`** for an email address the page does not show. **Not enforced** for usernames and account numbers, which have no shape to check.

## Risks / Trade-offs

- **A false report on a legitimate literal.** A test that types a *new* address into a sign-up form is the case: the address is not on the page, and it is not an account the test signs in as. → The wording says "if it is the account the test signs in as". It is a warning, the draft is kept, and the reviewer decides.
- **A page that displays the credentials hides the literal from the check.** Demo and staging logins often print them ("Demo credentials: …"); the demo app here does. An address copied from that hint *is* on the page, so D2 stays silent, and it has to: from the snapshot alone, a displayed credential and a displayed support contact look the same. Measured: 1 of 5 drafts under the new prompt copied the hint and was not reported. → Stated in the authoring reference's table as a limit of the check. The prompt is what moved this case, from 0 of 5 drafts using placeholders to 4 of 5.
- **A credential word used as a field name for something that is not a secret** — "set the token expiry to 30 days" — is now refused, and refusal discards a paid draft. → The error names the step, so the cost is one rerun or one hand edit. Accepted because the opposite error writes a password into a file; it is recorded here so it is not rediscovered as a surprise.
- **The model ignores the new rule anyway.** A prompt instructs and does not enforce (#57). → That is why D2 exists, for the one case with a shape. For the rest, the documentation says plainly that it is guidance.
- **The drift guard is the thing most likely to break**, because the rule is copied. → Both copies change in the same commit, and the guard's own test is the verification.

## Migration Plan

None. No config, no flag, no exit code. A `plan` run that drafts an invented address prints one more line per step.

## Open Questions

- **Should `run`'s authoring check report the same shape in existing suites?** It could, with the same "not on the page" condition, but `run` has no page at authoring time. It would need a different condition, which makes it a separate decision.
