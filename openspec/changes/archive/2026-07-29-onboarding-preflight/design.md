## Context

A first-time-user trial ran against the published package using only public documentation. It never executed a single browser step, and the reason it nearly stopped was never a wrong answer — it was an unexplained one.

`chromium.launch()` is uncaught at `src/commands/run.ts:584` and `src/commands/plan.ts:210`. When the browser cannot start, Playwright's exception reaches the terminal intact: about forty lines, the Chrome argv printed twice, `libnspr4.so: cannot open shared object file` sitting mid-line behind three hundred characters of flags. Meanwhile the missing-API-key error names the variable, the provider, both config keys and a copy-pasteable `export`. The distance between those two messages is the whole finding.

Prerequisites are also discovered serially: the browser launches before the model is contacted, and `base_url` is never checked at all, so a stopped app costs a model call to discover.

Two smaller items share the shape. `configSchema` is a plain `z.object`, so Zod strips unknown keys silently — a `budget:` block pasted into a version that predated the feature produced no error, no warning and no effect. And `plan` lacks `--dry-run`, so the command the documentation points at for coverage gaps is the one that cannot answer without a key.

## Goals / Non-Goals

**Goals:**
- Every failure at the prerequisite boundary is as actionable as the missing-key message already is.
- A user learns all of what is wrong in one run, not one item per run.
- A configured setting that does nothing says so.

**Non-Goals:**
- Installing anything on the user's behalf.
- A `doctor` subcommand.
- Rejecting unknown config keys.
- Any change to what the tool computes. This change alters only what it says.

## Decisions

**D1 — Preflight runs on the path people already take, not behind a subcommand.**

A `blastproof doctor` only helps someone who already suspects trouble; the person this is for believes their setup is fine and is about to learn otherwise. Putting the checks at the start of `run`, `plan` and `test` reaches them without being asked. Rejected: a separate command (helps only the already-suspicious) and a first-run-only check (the second machine, the CI runner, and the colleague are exactly where it matters).

**D2 — Report every unmet prerequisite together, not the first.**

Fail-fast is right when the first failure explains the rest; here the failures are independent. Stopping at the browser means learning about the unreachable provider on the next run, and about the stopped app on the one after. Three runs to learn three facts that were all knowable at once is the trial's "one crash at a time" verbatim.

**D3 — Only check what the command will actually use.**

`run --dry-run` needs neither browser nor model, and a preflight that demanded them would break the keyless path this project has just finished documenting as its most usable half. Checks are selected by what the command will spend.

**D4 — Recognised causes get a remedy; unrecognised ones still surface.**

Mapping a missing shared library to "install these packages" requires matching the error, and matching is inherently incomplete. So recognition adds a remedy but never replaces the underlying error when nothing matches. A message that swallowed an unanticipated failure to look tidy would trade a bad experience for an undiagnosable one.

**D5 — Unknown keys warn, never fail.**

Zod would reject them with `.strict()`, and that is wrong here: a config written for a newer blastproof should still run on an older one, and CI pinned a version behind the docs is the common case rather than the exotic one. Warning names the key and keeps going. The trial's `budget:` case is exactly this — the config was right, the binary was old, and only the silence was wrong.

**D6 — Preflight must not become a fourth thing to get right.**

Every check added here is a check that can itself be wrong, and a false failure at preflight blocks a run that would have worked — strictly worse than the raw dump it replaces. Reachability checks stay shallow: can a connection be made, does an endpoint answer. No credential validation, no model invocation, nothing that could fail for a reason unrelated to the prerequisite being tested.

## Risks / Trade-offs

- **A preflight check gives a false negative and blocks a working run** → the worst outcome available here. Mitigation: shallow checks only (D6), and every preflight failure names what was attempted so a wrong verdict is visibly wrong rather than mysterious.
- **Preflight adds latency to every run** → a connection attempt and a browser launch that was going to happen anyway; the browser check should reuse the launch rather than duplicating it.
- **Error-matching is version-coupled** — Playwright may reword its messages → D4 keeps the underlying error, so a stale pattern degrades to today's behaviour rather than to silence.
- **`base_url` responding is not the same as the app working** → true, and the check should claim no more than it verified.

## Migration Plan

No config or API change; new output only. An existing suite sees identical behaviour when its prerequisites are met, which is the case worth protecting.

Verification needs the failure paths exercised deliberately, since they are not on the happy path: a browser that cannot launch, an unreachable provider, a stopped app, and an unknown config key — each asserted on the message, not merely on the exit code. A test asserting only that it fails would pass against today's raw dump.

## Open Questions

- Should preflight be skippable with a flag, for someone who knows a check is wrong about their setup? Leaning yes if a false negative is ever reported, and no until then — an escape hatch added pre-emptively becomes the thing people paste into CI to make a real problem quiet.
