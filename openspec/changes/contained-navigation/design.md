## Context

`assertAllowedOrigin(url, ctx)` in `src/runner/actions.ts` builds the allowed set from `base_url` plus `allowed_origins:` and compares the URL it is handed. It is called from exactly one place: the `navigate` branch of `performAction` (`actions.ts:166`), immediately before `page.goto`.

So the boundary holds for one action, against one input, at one moment: the URL the model asked for, before the request is made. Everything after that moment is unchecked.

Measured against 0.7.0 with two local servers, `base_url` = `http://localhost:4197`, nothing declared in `allowed_origins:`:

| what the step did | where the browser ended up | what blastproof reported |
|---|---|---|
| `navigate to /away` (`302` → `:4196`) | `http://localhost:4196/` | PASS |
| `click the "Partner portal" link` (`href` to `:4196`) | `http://localhost:4196/` | PASS |

`Score: 100` for both. In the redirect run the judge stated the foreign URL out loud — *"the snapshot shows the current URL is http://localhost:4196/"* — and the run still passed, because nothing was comparing it to anything.

## Goals / Non-Goals

**Goals:**
- The boundary constrains where the agent *is*.
- No page outside the boundary reaches a prompt.
- One place decides it, for every action, including actions not written yet.

**Non-Goals:**
- Preventing the HTTP request that a redirect implies. It has already happened when we find out.
- Any new configuration. `allowed_origins:` is the escape hatch and already exists.

## Decisions

### D1 — Check where the page is, immediately before every snapshot

**Decision.** In the executor's per-step loop, after the settle wait and **before** `takeSnapshot`, compare `page.url()`'s origin against the allowed set. Outside it, the step fails with a reason naming the origin, and no snapshot is taken.

**Why at the snapshot and not after each action.** The snapshot is the single point where the page's content crosses into a prompt, and it is reached exactly once per iteration regardless of what the previous action was. Checking there covers every way a URL can change — `navigate`, a click on an anchor, a form submit, `location.href` from a script, a `meta refresh`, a redirect chain, and any action added to the vocabulary later — without anyone having to remember to add a call. Checking after each action instead would mean enumerating the actions that can navigate, which is the same enumeration mistake in a new place: the accessibility tree cannot tell you whether a button navigates.

It also gives the strongest property available at the right moment: **the content of a page outside the boundary is never sent to the model.** The request has already gone out by then, but the run does not read the response into a prompt, does not keep acting on that page, and does not carry the application's session further into it.

**Why not navigate back to `base_url` and continue.** Recovering silently would hide a real finding: an application that leaves its own origin is something the person running this needs to be told about, not something to paper over. Failing the step surfaces it with the origin named, and `allowed_origins:` is right there if the crossing is legitimate.

**Why not fail the whole run.** Every other action failure fails its step, and each test starts from a fresh browser context, so the breach cannot leak into the next test. Making this one uniquely fatal would be inconsistent for no added protection.

### D2 — `about:blank` is inside the boundary; everything else must match

**Decision.** A URL of `about:blank` passes. Every other URL is compared by origin, and anything that is not in the allowed set fails, including non-HTTP schemes such as `file:`.

**Why.** `about:blank` is the browser's own empty page: it carries no content and is what a fresh context shows before the first `goto`. Treating unknown schemes as allowed would be the same permissiveness that produced this defect — `file:///etc/passwd` has no origin to compare, and "no origin" must not mean "fine".

### D3 — One comparison, exported, used by both checks

**Decision.** The allowed-set construction and comparison move behind a single exported function in `src/runner/actions.ts`. The `navigate` branch keeps calling it before `page.goto`; the executor calls it before every snapshot.

**Why keep the pre-navigation check at all.** It is strictly better when it applies: refusing to make the request is better than making it and objecting afterwards, and it produces a more useful message (the model is told the target is out of bounds and can choose differently, rather than the step ending). The new check is the floor, not a replacement.

**Why not two copies of the comparison.** This change exists because a rule lived in one place while claiming to cover everything. Two implementations of the same rule that can drift apart would be a poor way to fix that.

## Risks / Trade-offs

- **An application that legitimately spans origins now fails instead of continuing.** Identity providers and hosted payment steps are the common shapes. The remedy already exists and the error names the origin to add. This is a behavioural change and belongs in the changelog in those words: a suite that was quietly testing a foreign page will now fail. That is the correct direction — it was never testing what it claimed to.
- **The check runs on every iteration.** It is a string comparison against a small set, built once per action context; against a snapshot round trip over CDP the cost does not register.
- **The request still happens.** A redirect to a hostile host still causes one request from the test browser, carrying whatever cookies that host was already entitled to. Nothing at this layer can prevent that; what changes is that the response never reaches the model and the run stops there. The proposal says so rather than implying more.

## Migration Plan

None. No configuration change, no test-file format change. Suites that stay inside their own origin see no difference. Suites that leave it were already broken and now say so.

## Open Questions

None blocking. One noted and deliberately left: `allowed_origins:` is currently all-or-nothing per origin, so declaring an identity provider allows the agent anywhere on that host. Narrowing it to path prefixes would be a separate change with its own reproduction, and no observed defect asks for it yet.
