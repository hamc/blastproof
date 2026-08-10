# Design: steps-name-their-value

## Context

The executor is forbidden from inventing values (`src/llm/prompts.ts:21`, the #28 fix): a value it types must come from the step, from the page, or from an `{{env.*}}` placeholder. A step that supplies none of the three cannot be carried out, and the runner is required to fail it — correctly, and expensively, after a browser launch, a key check and several model calls.

The rule is stated to two of the three authors of blastproof tests. `plannerSystemPrompt` (`src/llm/prompts.ts:161`) tells the model that generates drafts; the README's *Writing tests* tells a human reading it. The YAML itself is unchecked, which leaves the third author — the user's coding agent, plausibly the majority path — with a schema that accepts `fill the note field` exactly as readily as the version that runs.

`route-drift-warning` (merged, #18) established the shape this follows: a pure detection function, a single unconditional call site in `run.ts`, stderr, non-fatal.

## Goals / Non-Goals

**Goals:**
- Predict a step the runner cannot carry out, before anything is spent
- Fire only where the impossibility is certain from the text alone
- Cover every path `run` can take, from one place
- Give teams a way to enforce it in CI without imposing it on everyone

**Non-Goals:** #44's headline no-outcome heuristic (phase 2), a `validate` command, autofix, an LLM suggestion, a single-source refactor of the rules (#45), and **any language but English** (D9).

## Decisions

### D1: Warning by default, `--fail-on-authoring` to enforce

The issue's own recommendation was **failure**, on the argument that this rule is a fact rather than a heuristic: the runner cannot invent a value, so the step is impossible, not merely suspicious. The argument is sound about the *semantic* condition and does not transfer to the *detector*, which sees only text.

`prompts.ts:21` permits a value that comes **from the page**. So:

```yaml
- fill the recipient field with the address shown on the confirmation page
```

names no literal value, carries no `{{env.*}}`, and is legal today. A detector that fails on "no value in the step" blocks a test that works. D3 narrows the detector to keep this case silent, but the narrowing is a judgment about English, not a proof — which is exactly the condition under which this project has already decided to err toward not firing (#6: *"A false positive blocks a working config, which is worse than the silent failure this replaces."*).

Warning by default is also the reversible direction. Starting permissive and tightening costs a version bump; blocking somebody's legitimate test on day one costs trust that does not come back.

The honest objection is that a warning nobody reads is worth nothing. Two things separate this one from the usual fate: it arrives **before** anything is spent rather than buried in the output of a run that already cost tokens, and per D6 it shows the fix rather than citing the rule.

### D2: Check `setup` as well as `steps`

`setup` steps run through the same `executeTest` loop and fail the same way. A guarantee that covered `steps` only would be the call-site shape `AGENTS.md` names as this repository's recurring defect.

### D3: Ask whether the step has a connector, not whether it names a value

A step is flagged when it contains a value-entering verb **and** no connector.

The first shape of this decision asked the opposite question — does the step contain a value source? — and enumerated them: a `with` clause, a quoted string, an `{{env.*}}` placeholder, a reference to the page. That list cannot be closed. *Ways of naming a value* is an open set of English, and the enumeration fired on legitimate steps:

| step | why it fired | legitimate |
|---|---|---|
| `set the priority to High` | `to`, not `with` | yes, and commonly phrased that way |
| `enter Order not received in the subject field` | the value precedes the preposition | yes |
| `type the order number from the confirmation page` | `from`, not `with` | yes |

Inverting the question closes the set. A step that names a value always carries a **connector** — `with`, `to`, `as`, `using`, `into`, `from`, `:`, `=`, a quote, or `{{env.`. A step that names none is a verb followed by a field and stops. Connectors are a small, stable class; the phrasings they introduce are not.

One exception: `in` counts as a connector only when it is not adjacent to the verb. `fill in the note field` is a phrasal verb and a bare step; `enter Order not received in the subject field` is a value.

The verb set stays closed and small — `fill`, `enter`, `type`, `input`, `set` — for the reason the issue gives: *"something narrow is probably enough, and probably better than something clever."* Matching is word-boundary and case-insensitive, never substring: `setup the account` must not match `set`.

**The verb is anchored at the head of the step, not merely contained in it.** Found while implementing: `type` and `set` are nouns as often as verbs, so `verify the type is Premium` and `verify the set of results is empty` matched a contained verb, carried no connector, and were flagged — legitimate checks, reported as authoring defects. Test steps are imperative, so the leading word is the action; anchoring costs a step phrased as `then fill the note field`, which is a false negative and therefore the safe direction.

The two lists fail in opposite directions, and only one of them is dangerous. **An unlisted verb** produces a false negative — the check stays silent and the run fails honestly, exactly as it does today. **An unlisted connector** produces a false positive — a legitimate step is flagged. So the verb set is the one that must be extended carefully, and the connector set is the one that can be extended freely: adding a connector can only ever quiet the check.

**Alternative rejected:** parse the step with an LLM. Breaks the keyless guarantee that makes this check free, and reintroduces the cost the check exists to avoid.

**Accepted limit:** this will never be complete, in English or otherwise (D9). It is an early warning sitting on top of a failure that stays honest either way — a step the check misses still fails at run time, with the same message it produces today.

### D4: A new pure module, `src/runner/authoring.ts`

Not `selection.ts` — that module is about which tests run, and this is about whether a test can run at all. Not `testfile.ts` — see D5. A module named for the concern gives phase 2 (#44) and the #45 guard an obvious home, so the next two changes extend a file instead of choosing one.

Mirrors `mapImpact`/`detectRouteDrift`: pure logic returning data, unit-testable without a CLI; the caller decides what to print.

### D5: Not in `parseTestFile`

A step naming no value is valid YAML and a valid `TestFile`. Failing the parse would make the test unrunnable even for a user who disagrees with the check, removing the escape hatch D1 deliberately preserves. Detection reads a parsed `TestFile`; it never rejects one.

### D6: The message shows the rewritten step

The most persuasive thing this project has measured is a before/after (#44's 64→100). A warning citing the README is ignorable in the way all warnings are; one that prints the user's own step beside a corrected version is actionable without leaving the terminal. The correction is mechanical — append `with <value>` — and is presented as a shape to follow, never as a value the tool guessed.

### D7: `--fail-on-authoring`, exiting `EXIT_FAILED`

Named after `--fail-on-unmapped`, the flag this project already has for "promote a known-silent false negative to a gate". Three warnings under three naming conventions would be worse than any one of the names, so the convention is settled here while only one other exists.

Exit code is `EXIT_FAILED` (1), matching `--fail-on-unmapped` — a gate that failed, not a usage error (2). The check runs after parsing and before browser launch, the key check and any model call, so the gate costs nothing when it fires.

Unlike `--fail-on-unmapped`, this flag requires no companion: authoring is independent of the diff, so there is no `--impacted` precondition to validate.

### D8: A drift guard instead of a single-source refactor

This change makes a third copy of a rule that already exists twice and has already drifted once (#45). The refactor #45 proposes is real work with no user-visible result, and blocking on it would be the wrong order.

Instead, a test asserts the rule's key phrase appears in all three places — `plannerSystemPrompt`, the README, and this checker's own message. `tests/action-manifest.test.ts` is the precedent. Ugly, and it fails the moment they diverge, which is the thing #45 actually asks for.

### D9: English only, and the check says so

D3 is English grammar written into code: an English verb set, English connectors, an English phrasal-verb exception. A step written in any other language matches no verb and produces no finding.

**This is already reachable.** The schema is `steps: string[]`, nothing requires English, and the executor passes the step to a model that reads any language — so a non-English suite runs today and would silently receive none of this check while an English one receives all of it. A guarantee that holds over part of its scope is the defect class `AGENTS.md` names as this repository's recurring failure.

It is scoped out rather than solved, for a reason that survives being written down: a per-language verb and connector set is five words times *n* languages, each set a new false-positive surface, and none of them verifiable by anyone here. The cost grows linearly and the confidence falls.

Two consequences, both required by this decision rather than optional:

1. The README states the check is English-only where it documents the check, so nobody infers coverage that does not exist.
2. The Open Question below is the real fix, and it is filed as an issue rather than left in this document — a design's Open Questions are not a backlog anyone reads.

### Rejected alternatives

- **A1 — per-language verb and connector sets.** See D9. Linear cost, no verifiability, and every added language is a fresh false-positive surface.
- **A2 — a structured intermediate.** Compile the English step once into `{action, field, value}` and validate the *data* rather than the text; "no value" becomes an absent field, language-independent by construction. The strongest known answer to this problem and out of scope here — it is a compilation stage this project does not have, not a check. Related to the run-time classification in the Open Questions, and a plausible home for it.
- **A3 — structured YAML.** Require `fill: {field, value}` in the test file, making the defect unrepresentable rather than detectable. Rejected on identity grounds: plain English is what this project is. Recorded because "make it impossible" deserves to be visibly rejected rather than silently skipped.
- **A4 — parse the step with an LLM.** Breaks the keyless guarantee that makes this check free, and reintroduces the cost the check exists to avoid.

## Risks / Trade-offs

- **A legitimate step is flagged anyway** (a connector D3 does not list) → Non-fatal by default, so nothing is blocked; the fix is to add the connector, which only ever quiets the check. This risk is the reason D1 is a warning: under a hard failure, every unlisted connector would be a test nobody can run.
- **The check is silent on a step it should catch** (a false negative from an unlisted verb) → Accepted. Under-firing is the deliberate direction, and the run still fails honestly, exactly as it does today.
- **A team ignores standing warnings** → `--fail-on-authoring` is the answer for teams who want the gate; D6 is the answer for the rest.
- **The third copy of the rules drifts** → D8. Not eliminated, only made loud.
- **Wording changes break the D8 guard** → True, and intended: the guard fires so the other two copies get updated in the same change.
- **A non-English suite is silently unchecked** (D9) → Not mitigated, and the most serious limitation here. Documented in the README rather than hidden, and answered properly by #53. Until then this check covers English suites only, and says so.

## Migration Plan

Additive. Default exit codes are unchanged; a suite with no value-entering steps sees no output. Rollback is removing the call site — detection is pure and referenced nowhere else.

## Open Questions

- **Classify the failure at run time, in any language.** `prompts.ts:21` already asks the model to make exactly this judgment — *"If a step needs a value it does not give you, that is a failing step"* — so the condition is decided with certainty during a real run, free of grammar, phrasing and language. What is missing is not the detection but the **classification**: that `fail` is today indistinguishable from "the button was absent" or "the application broke", which is precisely the harm #44 describes (the user concludes the application is broken). Giving `fail` a category would let the report say *this is a problem with the test, not with your application* correctly and in any language.

  That reframes this change honestly. Run-time classification is the guarantee; the text check in D3 is an ahead-of-time optimization sitting on top of it, buying "before anything is spent" at the price of "English only". Shipping the optimization first is a deliberate order, not a claim that it is sufficient. Filed as #53 rather than left here.

- Should `--fail-on-authoring` also gate `plan`, which generates tests rather than reading them? Drafts already obey the rule via `plannerSystemPrompt`, so the gate would be checking our own prompt. Deferred until a generated draft is observed violating it.

---

## Correction, 2026-08-10 — the premise above is wrong

This design's Context, D1 and Open Questions all rest on one claim: that a step
supplying no value **cannot be carried out**, because `prompts.ts:21` forbids the
executor from inventing one. Measured against the real demo app with a real model,
hours after this shipped, the claim is false.

`fill the note field`, run in isolation three times:

```
1 → fill textbox "Note" [This is a test note.]  → PASS  Score: 100
2 → fill textbox "Note" [This is a test note.]  → PASS  Score: 100
3 → fill textbox "Note" [This is a new note]    → PASS  Score: 100
```

The model invents a value, the step passes, and the value differs between runs.
The prompt rule is an instruction, not an enforcement, and the model declines it
without difficulty.

The body of this document is left as written, because it records what was believed
when the decision was made and the reasoning is otherwise sound. What changes:

- **The harm is worse than argued, not milder.** Not "a failure 80 seconds in that
  reads as though the application is broken" — a **passing** test over an input
  nobody wrote, differing run to run. A green check that verifies nothing specified
  is the exact false negative this project exists to remove.
- **D1's conclusion survives, its reasoning does not.** Warning over failure was
  chosen because the detector is a judgment about English rather than a proof; that
  is still true. But the counter-argument it answered — "this is an impossibility,
  not a probability" — was never available to either side.
- **#53's framing needs revisiting.** It proposes classifying a *failure* by cause.
  There is no failure to classify here; the run is green.
- **This is the recurring defect class again**, and `AGENTS.md` already names it:
  a guarantee implemented as guidance rather than enforced over the scope. #46 makes
  the identical argument about agent skills — *"guidance at the call site, not a
  guarantee over the scope"* — and it applies word for word to `prompts.ts:21`.
  The enforcement mechanism already exists elsewhere in the executor: the repeated-
  commit refusal built for #28 stops an action rather than asking the model not to
  take it. The value rule never got one. Filed as #57.
