# Design: run-wide-secret-mask

## Context

Three leaks survived a fix that was described as closing the boundary. Each is a different shape of the same mistake: the guarantee was implemented at a site rather than defined over a scope.

## Goals / Non-Goals

**Goals:** one mask per run covering every live secret; every model-facing caller uses it; encoded forms covered; `--dry-run` honours the gate.

**Non-Goals:** covering arbitrary page-side transforms of a secret; changing report masking; any user-visible interface change.

## Decisions

### D1: The mask's scope is the run, not the test
A secret is dangerous for as long as it exists in the session, not for the duration of the test that declared it. The authentication credential is the clearest case: it is typed once, and every subsequent test browses a session that may render it. Building the mask per test from that test's own steps guaranteed the auth secret was invisible to all of them.

One mask is now seeded from the auth recipe and from every discovered test's placeholders, then shared. The cost is that a secret from one test masks in another test's prompt — harmless, since the alternative is leaking it.

### D2: Every caller that prompts a model takes the mask, and that is the invariant to check
`plan` was missed because the previous fix asked "is the executor's boundary closed" rather than "does everything that reaches a model go through a masker". The second question is the one that generalises; the first is how `plan` shipped with no redaction on a path that authenticates first.

So the planner takes the mask as a required part of its options rather than an optional extra. A future command that prompts a model will not compile without deciding what to pass.

### D3: Encoded forms are masked, and the limit is stated
`navigate` reports the resolved URL, and `new URL()` percent-encodes — so a secret containing a space stopped matching a literal search. Each registered secret now also registers its `encodeURIComponent` form.

This does not cover every possible transform, and pretending otherwise would repeat the error this change exists to fix: a page can render a credential in ways no masker anticipates. Percent-encoding is covered because an ordinary action produces it. The README says the rest plainly.

### D4: `--dry-run` runs the gate it was bypassing
The dry-run branch returned before `finalize`, where the `--fail-on-unmapped` check lives, so `--dry-run --fail-on-unmapped` printed the unclassified files and exited 0. That combination is the natural CI pre-flight — free, keyless, browserless — which makes a false green there worse than elsewhere.

## Risks / Trade-offs

- A broader mask can redact ordinary page text that coincides with a secret → Accepted: `maskSecrets` already orders longest-first, and a confusing prompt beats a leaked credential.
- Masking cannot be complete against a hostile or creative renderer → Stated in the README rather than implied away.
- Sharing one mask across tests slightly weakens isolation of *reporting* → Accepted for the same reason as the first point.

## Migration Plan

No user-visible change; nothing configured or authored moves.

## Open Questions

(none)
