## Why

The origin boundary checks where the agent asks to go, never where it ends up. Both ways out were reproduced against 0.7.0, with a real model, using two local servers so that "another origin" is real:

**A redirect.** `navigate to /away` targets the application's own origin, so the check passes. The server answers `302` to a foreign host and the browser follows. The judge's own words in the run log: *"the current URL is http://localhost:4196/"*.

**A click.** `assertAllowedOrigin` is called in the `navigate` branch and nowhere else, so clicking a link to another origin is not checked at all. This is broader than #3 as filed, which only describes redirects.

Both runs reported **`Score: 100`**. The tool drove the agent out of the application twice and called it a pass.

What makes this more than untidy: once outside, that page's content goes into the next prompt, while the browser context still holds the application's session. `agent-containment`'s stated purpose is "so a page that can influence its own content cannot redirect an agent holding a live session" — which is precisely what happens. The prompt already tells the model that page text is content under test and never instructions; that defence assumes the page belongs to the application being tested.

This is the third time the same underlying mistake has produced a defect here: a guarantee written at one call site instead of over the scope it claims to cover. It has previously produced a secret leak, a budget that missed `plan`, and a timeout that missed `auth`.

## What Changes

- The boundary is enforced on **where the page actually is**, not only on where an action asked to go. It is checked before every snapshot, so no action type can escape it — a redirect, a click on a foreign link, a form submit, a script setting `location`, or any action added later.
- A page outside the boundary is never snapshotted into a prompt. The step fails, naming the origin.
- The existing pre-navigation check stays. Refusing to go somewhere is still better than going and then objecting.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-containment`: the origin boundary constrains where the agent *is*, not only where it asked to go, and no page outside it reaches a prompt.

## Non-goals

- Not removing `allowed_origins:`. An application that legitimately spans hosts — an identity provider, a hosted payment step — declares them, exactly as it does today. That mechanism already exists; this change makes it load-bearing rather than advisory.
- Not blocking the browser from following a redirect. By the time a cross-origin response arrives the request has already been made; what this change controls is what happens next, which is what actually protects the run.
- Not failing the whole run. A containment breach fails its step, like any other action failure, and the next test starts from a fresh context.
- Not the iframe gap (#21) or the action vocabulary (#22).

## Impact

- `src/runner/executor.ts` — one check before every snapshot; `src/auth.ts`'s login journey runs through the same loop and is covered by the same line.
- `src/runner/actions.ts` — the origin comparison becomes reusable; the `navigate` branch keeps calling it.
- **Behavioural change**: an application that redirects across hosts without declaring them in `allowed_origins:` now fails instead of silently continuing. That is the point, and it needs saying in the changelog.
- No new npm dependency.
