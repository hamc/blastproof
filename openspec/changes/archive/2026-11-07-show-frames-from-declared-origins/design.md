## Context

`captureSnapshot` (`src/runner/snapshot.ts`) returns `page.locator('body').ariaSnapshot({ mode: 'ai' })`, trimmed and prefixed with the URL. Every snapshot goes through it: `defaultSnapshot` in the executor, which the login journey and the planner also use. In AI mode an `iframe` line has the frame's content as its children, and every ref inside a frame carries the frame's prefix: `f1e4` is element 4 of frame 1. `bindTarget` refuses a ref that is not on the snapshot the model read.

The boundary is `base_url`'s origin plus `allowed_origins:`, compared by `isOriginAllowed` (`src/runner/actions.ts`). It is checked for every `navigate`, and for the page's own URL before every snapshot. It is not checked for frames.

A probe on a page with a cross-origin frame holding a same-origin frame, a `srcdoc` frame and a sandboxed frame:

```
- iframe [ref=e3]:
  - generic [ref=f1e1]:          # http://localhost:4391/outer.html
    - iframe [ref=f1e3]:
      - generic [ref=f4e1]:      # http://127.0.0.1:4390/form.html, inside f1
- iframe [ref=e4]:
  - button "Inline" [ref=f2e2]   # about:srcdoc
- iframe [ref=e5]:
  - generic [ref=f3e1]:          # http://127.0.0.1:4390/form.html, sandboxed
```

`page.locator('aria-ref=<ref>').elementHandle()` then `ownerFrame()` gave the right frame for each prefix, `url()` its URL and `parentFrame()` its parent.

## Goals / Non-Goals

**Goals:**

- A frame's content reaches a prompt only from an origin the user declared.
- A user whose frame is left out learns which origin and how to show it.

**Non-Goals:**

- Real providers' widgets, same-origin frames, navigation (proposal).

## Decisions

### D1. Cut at capture, in `captureSnapshot`

After `ariaSnapshot`, each `iframe` line's frame is found from two refs: the `iframe` line's own, which Playwright writes and the page cannot, resolved to the frame it shows (`elementHandle()`, `contentFrame()`); and the first ref among its children, resolved to the frame it is in (`ownerFrame()`). The frame is shown only when the two are the same frame and its origin is allowed. Both refs are read from a line's attribute group, never from its text: a frame names its own elements, and a heading named `[ref=e1]` inside it must not pass for the page's `e1` (found in review). The content ref is tied to the document the snapshot read, so a frame that navigated since does not resolve and is cut. Otherwise every line indented under the `iframe` line is replaced by one:

```
- iframe [ref=e5]:
  - text: "content not shown: https://pay.example.com is not in allowed_origins"
```

Cutting the lines removes the refs, so an action on one is refused by `bindTarget` as a ref the snapshot does not have: enforcement by the ref check that already exists, not by prompt wording. The line says why, so the model can fail the step with a reason instead of searching for the form, and the judge reads the same thing.

It is cut before `trimSnapshot`, so a hidden frame does not use the line budget, and before masking, which runs on what is returned.

A page with no `iframe` line costs nothing: no frame is resolved. A page with frames costs one resolution per frame per snapshot.

`captureSnapshot` is the place because every snapshot passes through it: the executor, the re-observation, the look-again on a page still rendering, the login journey and the planner. `defaultSnapshot` takes the boundary as a required argument, so a caller that forgets it does not compile; a boundary applied at one call site is the defect `AGENTS.md` names.

### D2. Which origin a frame has

The frame's URL, compared by `isOriginAllowed` with the boundary navigation uses. A frame whose URL has no origin of its own (`about:blank`, `about:srcdoc`) takes its parent frame's decision, as it takes its parent's origin in the browser. A frame under a frame that is cut is cut with it, since its lines are under the cut `iframe` line.

A `blob:` frame is judged by the origin inside its URL (`blob:https://app/…` is the app's), which is the page's own scripts that made it.

A sandboxed frame without `allow-same-origin` has an opaque origin in the browser, but its URL names the server it was loaded from. The URL decides: what matters here is who wrote the content, not what the browser lets it read.

A frame whose origin cannot be read (a ref that does not resolve, the two refs in different frames, a frame whose content has no element with a ref) is cut, with `content not shown: the frame's origin could not be read`, and no warning, since there is no origin to name. A frame whose URL has no web origin (`data:`, `file:`) is cut with `content not shown: a data: frame is never shown`, and no warning either: `allowed_origins:` cannot name it.

### D3. One warning per origin, per run

`captureSnapshot` reports each cut origin through a callback the run supplies. `run` and `plan` collect them and print, once per origin, after the tests:

```
warning: content from https://pay.example.com was not shown to the agent: it is in a frame on a page under test,
and not in allowed_origins. Add it to allowed_origins in .blastproof/config.yaml if the agent should read and act on it.
```

It goes through `emitWarning`, so the HTML and JUnit reports carry it (the-reports-carry-the-warnings). It is printed before a failed login exits too, since a login form in an undeclared frame is the likeliest cause of that failure. `test` runs `run` and then `plan`, and each phase prints its own warnings, so an origin met in both is named once per phase.

### D4. The documentation states what works

The README's trust boundaries say frames follow the same origins, and the unsupported list loses "embedded widgets". It says that a provider's hosted fields are often nested and sandboxed, that nesting is covered, and that a provider's widget has not been measured here. The site's list changes after a preview.

### Rejected

- **Show every frame, document it** (the state today). Third-party content reaching the model with no declaration is the widening #21 refused.
- **A separate `allowed_frame_origins:`.** Two lists for one question, "which origins may the agent read". A user who declares a payment provider for its redirect means its frame too.
- **Cut in the prompt layer, not at capture.** The snapshot is also the source of refs and of readable values (`refuse-an-invented-value`); content cut later would still be quotable.
- **Hide the `iframe` line too.** The model would not know a form exists and why it cannot see it, and would hunt for it until the step ran out of attempts.

## Risks / Trade-offs

- [A user's checkout that passes today fails after upgrading] → it fails on the frame's own line, and the run's warning names the origin to add. A frame that worked only because nothing checked it is exactly what this closes; the CHANGELOG says so.
- [One resolution per frame per snapshot] → only on pages with frames; a page with ten frames adds ten lookups to a snapshot that already takes a settle wait.
- [The first child of an `iframe` line is not a ref line] → a frame with no element (an empty frame) has no content to cut; an `iframe` line with children and no ref is cut as unknown.

## Verification

Unit tests on snapshot text and a fake frame lookup: allowed, not allowed, nested, `srcdoc`, unresolvable, no frames (no lookup), the warning once per origin. Live, the fixture used for the measurement: the cross-origin frame fails on both models with the warning naming the origin; with the origin in `allowed_origins:` it passes 5/5 on Haiku and Luna; the same-origin frame passes 5/5 without a declaration. The dogfood suite still passes.

Result, `anthropic/claude-haiku-4.5` and `openai/gpt-6-luna`, 5 runs each: the cross-origin frame undeclared failed 5/5 on both, each run naming the frame as not accessible, with one warning per run naming `http://localhost:4391`; declared, it passed 5/5 on both; the same-origin frame passed 5/5 on both. The dogfood suite passed 10/10 on Haiku.
