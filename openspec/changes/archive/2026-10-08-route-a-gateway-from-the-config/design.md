# Design: route-a-gateway-from-the-config

## D1. A body merge in `fetch`, not provider options

The AI SDK's OpenAI provider passes only the fields it knows. OpenRouter's `provider` object is not one of them, and neither is any other gateway's extension. `createOpenAI` accepts a `fetch`. `createModel` passes one that parses each JSON request body, merges `extra_body` under it, and sends the result. The name and the shape follow the OpenAI SDKs' own `extra_body`, which is how their users already reach these fields.

Rejected: **a typed `llm.routing` with OpenRouter's fields.** It would bind blastproof to one gateway's API, and every other gateway's extension would need a release.

## D2. blastproof's fields win

Merged as `{ ...extra_body, ...body }`: a key the SDK set is never replaced. `extra_body: { max_tokens: 64000 }` cannot undo #126, and `response_format` cannot be dropped. The merge is shallow, because what the SDK sets is top-level. A key it does not set, such as `provider`, passes through whole.

## D3. OpenAI-compatible providers only

The Anthropic API rejects unknown fields, and nothing there needs them. `extra_body` with `provider: anthropic` is refused when the config loads, naming both, rather than failing on the first call.

## D4. Rejected: repairing a fenced answer

Of about 100 unusable answers captured, 2 were valid JSON inside a markdown fence. The rest were broken JSON (an unclosed string or brace), a whitespace runaway, or no object at all. A repair narrow enough to be safe would fix 2%. One broad enough to matter would guess at a model's intent, and a guessed action is worse than a failed attempt.
