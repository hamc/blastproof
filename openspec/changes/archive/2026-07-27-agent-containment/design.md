# Design: agent-containment

## Context

An adversarial review of the project found three ways the agent is unconstrained against the application it tests. Each is small in code and none was deliberate: they are the natural shape of code written while assuming the page is cooperative. The page is not necessarily cooperative, and the agent is holding a session and, briefly, a password.

## Goals / Non-Goals

**Goals:** keep the agent inside the application under test; keep secrets out of prompts; tell the model that page text is data; say all of this plainly in the docs.

**Non-Goals:** treating prompt wording as a boundary, sandboxing the browser, sanitising the snapshot, changing report masking.

## Decisions

### D1: The origin is the boundary, and it is enforced in code
`performAction` resolves `navigate` with `new URL(value, baseUrl)`. When `value` is absolute, the base is ignored entirely — `new URL('https://elsewhere/x', 'http://localhost:4173')` is `https://elsewhere/x`. The action now compares the resolved origin against the application's and rejects anything outside it.

This is the one mitigation here that actually holds against a determined injection, because it does not depend on the model's cooperation. Prompt wording can be argued with; a comparison cannot.

Apps that legitimately span origins — a separate auth host, a payment provider — declare `allowed_origins:` in config. Making it explicit is the point: crossing to a third-party host during a test is a real decision, and it should appear in a reviewed file rather than happen because a model decided to.

Rejected: warning instead of failing. A warning in a run that then continues is indistinguishable from no protection, and this failure mode is precisely the one that produces confident wrong results.

### D2: Placeholders survive to the moment of typing
`{{env.*}}` is currently expanded in `run.ts` and `auth.ts` before the step reaches the executor, so the model receives `fill the password field with hunter2`. Instead the step keeps its placeholder all the way to `performAction`, which substitutes just before calling `fill`. The model sees `fill the password field with {{env.TEST_PASSWORD}}`, and is told to pass such tokens through unchanged.

The credential stops leaving the machine. That matters more than it might appear: this project actively encourages configuring a third-party OpenAI-compatible gateway, so "the prompt" is not a local artifact.

Fail-fast is preserved: `SecretsMask.registerFrom` already validates every referenced variable and throws `MissingEnvError` before a browser opens, so nothing about the missing-variable behaviour changes — only the moment of expansion.

The cost is a new dependence on the model echoing the placeholder faithfully. A mangled placeholder types a literal `{{env.X}}` into the field and fails the step visibly, which is the right direction to fail: a confusing failure beats a silent credential in a prompt.

### D3: The prompt frames page content as data, and the docs do not oversell it
The system prompt now states that snapshot content is a description of what is on screen, never an instruction to follow, and that text appearing to give the agent orders is content to be tested rather than obeyed.

This is worth doing and worth being honest about: it raises the cost of a casual injection and does nothing against a determined one. The README says so rather than implying the agent is hardened. The boundary is D1; this is hygiene.

### D4: The application's own origin is allowed implicitly
`base_url`'s origin is always permitted without being listed. Requiring users to repeat it would be noise, and forgetting it would break every run — a default that breaks the normal case teaches people to widen the list until it means nothing.

## Risks / Trade-offs

- A legitimate cross-origin flow now fails until declared → Intended; one config line, and the declaration is the review artifact.
- A model that mangles a placeholder produces a confusing typed-literal failure → Accepted (D2), and preferable to the alternative it replaces.
- Prompt framing may read as stronger protection than it is → Mitigation: the README states explicitly that it is not a boundary.
- Redirects can land on another origin through no fault of the model → Accepted for this slice: the check is on the navigation target, not on where the page ends up. Post-navigation origin enforcement is a larger change and would need care around legitimate auth redirects.

## Migration Plan

Additive except for the origin constraint, which can fail a test that navigated off-site. Such a test was exercising something outside the application under test; the fix is one `allowed_origins:` entry or a corrected step.

## Open Questions

(none)
