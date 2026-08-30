# Design: portable-structured-output

## Context

`generateObject` turns a Zod schema into a JSON Schema and asks the provider to fill it. Anthropic treats that schema as a description. OpenAI's strict mode treats it as a contract and validates it before running the model: every key of an object must appear in `required`, and a value that may be absent is declared nullable rather than omitted.

`agentActionSchema` was written for the first reading. `target` is an optional object whose own properties are optional, so under the second reading it is malformed twice over — and the request is refused before a token is spent.

The failure is silent in the worst way. The request never runs, so the executor sees an error rather than a bad answer, treats it as a failed attempt, and sends the identical rejected request twice more.

## Goals / Non-Goals

**Goals:**
- The documented OpenAI path makes calls
- The parsed object is unchanged, so nothing downstream is touched
- A provider that explains a refusal has its explanation reach the user

**Non-Goals:** changing what the model is asked to decide, distinguishing a rejected request from a bad response inside the retry budget, redesigning schemas that are not sent to a rejecting provider.

## Decisions

### D1: Nullable on the wire, `undefined` after the parse
Each optional field becomes `.nullable()` and carries `.transform((v) => v ?? undefined)`. The JSON Schema then declares the key as present-and-nullable, which strict mode accepts, while `z.infer` still yields `string | undefined` and every consumer reads exactly what it reads today.

The alternative — `.nullable()` alone, and change the 22 call sites to handle `null` — was rejected on blast radius against benefit. Most of those sites use `?.` or `?? ''` and would behave identically, which is precisely why the change would be easy to make and hard to review: a diff that touches twenty-two places to alter nothing observable is a diff nobody reads carefully, in files that decide which element gets clicked.

Flattening `target` into `targetRole`/`targetName`/`targetText` was also rejected. It removes the nested optional object that caused this, and it changes the shape the model is asked to produce — which is a prompt change wearing a schema change's clothes, on the one call whose output decides every action.

Verified before proposing, one `generateObject` call per provider with the real schema shape: `gpt-4o-mini`, `claude-haiku-4.5` and `gemini-2.5-flash-lite` all accepted it and all parsed to an object with `undefined` where a field was absent.

### D2: Quote the provider, do not summarise it
`AI_APICallError` carries `responseBody`. Today it is dropped and the user reads `Provider returned error`, which names nothing and suggests nothing.

The provider's own message named the field, the constraint and the rule — enough to diagnose in a minute. Discarding it cost an afternoon and would have cost a user their evaluation of the tool, because the evidence they are given supports exactly one conclusion: it is broken.

This is the standard `AGENTS.md` already sets at the prerequisite boundary — name the component, name the provider, give a remedy — applied to the one boundary that was exempt. It is general: it improves every provider refusal, not the one this change fixes.

### D3: The two halves ship together
The schema fix alone would close #85 and leave the next provider refusal just as unreadable — and the next one will not have someone spending an afternoon with `curl` to decode it. The message fix alone would make this diagnosable and still broken.

They are separable in code and not in value, and the second is what makes the first verifiable by anyone other than its author.

## Rejected alternatives

- **`.nullable()` without the transform, updating 22 call sites** — a large diff that changes nothing observable, in the files that decide which element is clicked (D1)
- **Flattening `target`** — changes what the model is asked to produce, on the call that decides every action (D1)
- **`structuredOutputs: false` to fall back to tool calling** — tried against `gpt-4o-mini` and still refused, so it does not even work; it would also silently change the mechanism by which every decision is obtained
- **Retrying a rejected request fewer times** — treats the symptom, and the distinction between a bad request and a bad response is worth its own change

## Risks / Trade-offs

- **`.transform()` sits between the schema and the parsed value.** Anything that later reads `agentActionSchema` expecting the raw wire shape — a serialiser, a fixture, a test asserting on parsed output — sees `undefined` where the model sent `null`. That is the intent, and it is a place a future reader can be surprised.
- **Verified through a gateway, not against `api.openai.com`.** The rule is OpenAI's, and Azure enforced it. Direct access is very likely identical and is not measured.
- **The model may now answer `null` where it previously omitted the key.** Semantically the same to every consumer after the transform, and confirmed on three providers — but it is a change in what comes back over the wire.

## Migration Plan

Nothing to migrate. No config, no file format, no flag. A suite that runs on Anthropic today produces the same parsed decisions after; a suite that could not run on OpenAI at all now can.

## Open Questions

- **Does `api.openai.com` behave as Azure did?** Expected, unmeasured, and worth a line in the issue when someone with a key checks.
- **Should a rejected request stop the run instead of retrying?** Three identical refusals is three times the wait for the same answer. Out of scope here, worth its own issue.
- ~~**Is `generatedTestSchema` exposed to the same rule?**~~ Answered while writing this: it declares no optional fields, and neither does `assertJudgmentSchema`. All six live in `agentActionSchema`, which is why only the executor's call is refused and `plan` was never implicated.
