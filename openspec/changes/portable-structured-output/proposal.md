# Proposal: portable-structured-output

## Why

`provider: openai` with its own documented default makes **zero model calls**. The schema is rejected before the model is asked anything, and the run reports `Provider returned error` after burning three retries (#85).

OpenAI's strict structured-output mode requires every key of an object to appear in `required`; an absent value is expressed as nullable, not omitted. `agentActionSchema` nests optional properties inside `target`, so the request never validates. Anthropic does not enforce this, which is why the default provider works and this went unseen.

Measured through OpenRouter: `gpt-4o-mini`, `gpt-5-mini` and `gpt-5.6-luna` all rejected; `claude-haiku-4.5` and `gemini-2.5-flash-lite` accepted. The router that enforced it was Azure — the way an enterprise runs OpenAI, and the audience least able to shrug it off.

## What Changes

- Optional fields in the schemas the model fills become `nullable` on the wire and are transformed back to `undefined` on parse, so the request validates everywhere and no consumer of `AgentAction` changes
- `AI_APICallError`'s `responseBody` is surfaced instead of discarded, so a provider that explains itself is quoted rather than summarised as `Provider returned error`

## Capabilities

### Modified Capabilities

- `llm-providers`: structured output is expressed in the subset every supported provider accepts, and a provider's own error reaches the user

## Impact

- New dependencies: **none**
- Affects: `src/llm/schemas.ts`, the error path in `src/llm/brain.ts` or `provider.ts`, and the tests around both
- No config surface, no flag. A suite that runs today runs unchanged: verified across three providers, the parsed object is identical to today's, `undefined` included

## Non-goals

- **No change to what the model is asked for.** Same fields, same descriptions, same decisions — only how absence is spelled
- **No retry on a schema rejection.** A malformed *response* is worth a retry; a malformed *request* is the same rejection three times. Making that distinction is real work and belongs to its own change; this one stops producing the rejection
- **No verification against `api.openai.com` directly.** Measured through a gateway. The rule is OpenAI's own so the direct path is very likely affected, and someone with a key should confirm rather than assume
- **No change to the other two schemas.** Checked rather than assumed: `assertJudgmentSchema` and `generatedTestSchema` declare no optional fields at all. All six are in `agentActionSchema`, which is why only the executor's call is refused
