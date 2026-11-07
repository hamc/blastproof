## Why

#21 says the agent cannot see inside an `iframe`, so an embedded checkout is out of reach, and the README and the site list "embedded widgets" as unsupported. That stopped being true when every snapshot moved to `ariaSnapshot({ mode: 'ai' })` (act-on-the-element-the-model-read): AI mode includes each frame's content, with refs of its own (`f1e4`), and an action on such a ref acts inside the frame.

Measured on a local checkout page whose card form sits in an `iframe`, with the step `type the card number "4242 4242 4242 4242" in the payment form and click Pay`, then a check for "Payment accepted" inside the frame, 5 runs each:

| | Frame on the app's origin | Frame on another origin |
| --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 5/5 | 5/5 |
| `openai/gpt-6-luna` | 5/5 | 5/5 |

The second column is the problem #21 asked to decide rather than assume: "the origin boundary must not be quietly widened to make this work". It was widened quietly. A frame from any origin reaches the model and can be acted on, with nothing in `allowed_origins:`, while a navigation to that same origin is refused. A third-party frame is content the user never declared, and it is where a page most easily hosts text addressed to the agent.

## What Changes

- A frame's content is shown only when its origin is the application's or one `allowed_origins:` declares. A frame from any other origin keeps its `iframe` line in the snapshot, and its content is replaced by one line saying it is not shown and why. Its elements have no refs the model can act on, so an action on them is refused by the existing ref check.
- A frame inside a frame that is not shown is not shown either. A frame with no origin of its own (`about:blank`, `srcdoc`) is judged by the frame that contains it.
- The run prints one warning per origin left out, naming it and the `allowed_origins:` line that shows it, and the reports carry it like every other run warning.
- The rule holds at the one function every snapshot passes through, so the executor, the login journey and the planner get it alike.
- Documentation: the README's trust boundaries cover frames, "embedded widgets" leaves the unsupported list in the README and the site, `docs/configuration.md` names a payment frame as a reason to declare an origin.

## Non-goals

- **Payment providers' real frames.** Hosted card fields are often nested several frames deep and sandboxed. The mechanism covers nesting; whether a given provider's widget can be driven is for a user's run to show, and the docs say so.
- **Frames on the page's own origin.** They were already visible and stay so, with no declaration.
- **Changing navigation.** The navigation boundary is unchanged; this applies the same set to frames.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-containment`: frame content is bounded by the same origins as navigation.

## Impact

- `src/runner/snapshot.ts`: `captureSnapshot` takes the allowed origins, finds each frame's origin and cuts the frames outside them.
- `src/runner/executor.ts`, `src/auth.ts`, `src/planner.ts`: `defaultSnapshot` requires the origins, so no caller can take a snapshot without them.
- `src/commands/run.ts`, `src/commands/plan.ts`: the warning.
- Tests for the cut, nesting, `srcdoc`, the warning and the refusal of a hidden ref.
- `README.md`, `docs/configuration.md`, `site/index.html` (preview first), the CHANGELOG.
- No new dependency.
