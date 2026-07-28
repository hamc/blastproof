# Proposal: agent-containment

## Why

The page under test is not trusted input, and the agent currently treats it as if it were. Its accessibility snapshot goes into the prompt with nothing marking it as data rather than instruction; `navigate` resolves through `new URL(value, base_url)`, so an absolute URL leaves the application entirely with no constraint; and `{{env.*}}` placeholders are substituted *before* a step reaches the model, so a real password is sent verbatim to whatever LLM endpoint is configured — including the third-party gateways this project's own README recommends. At that moment the agent holds a live authenticated session. A page able to influence its own accessible text — a compromised staging build, a third-party widget, stored XSS — is talking to it.

Masking protects logs. It does nothing about what the agent can be persuaded to do, or about where the credential has already been sent.

## What Changes

- Constrain `navigate` to the application's origin, with an optional `allowed_origins:` list for apps that legitimately span hosts; an attempt to leave fails the step with a clear reason
- Stop substituting `{{env.*}}` before the model sees a step: placeholders survive into the action and are resolved at the moment of typing, so a secret never enters a prompt
- Instruct the model that snapshot content is data to act on, never instruction to obey, and that placeholders are passed through unchanged
- Document plainly that page content reaches the model, and what that means for a hostile application

## Capabilities

### New Capabilities

- `agent-containment`: the origin constraint, the secret boundary, and the untrusted-content framing

### Modified Capabilities

- `agentic-execution`: `navigate` is bounded by origin, and steps reach the model with placeholders intact

## Impact

- New dependencies: **none**
- Affects: `src/runner/actions.ts`, `src/runner/executor.ts`, `src/commands/run.ts`, `src/auth.ts`, `src/llm/prompts.ts`, `src/config.ts`, `tests/`, README
- Behaviour change: a test that navigated to another origin now fails. That is the point, and such a test was outside the application it claims to cover

## Non-goals

- No claim that prompt wording is a security boundary; it is a first line, and the origin constraint is the boundary
- No sandboxing of the browser process, no network interception, no content sanitisation of the snapshot — the accessible text *is* the input the agent needs
- No change to how reports mask secrets; that layer stays exactly as it is
