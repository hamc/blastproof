# Proposal: withhold-a-screenshot-that-saw-a-secret

## Why

`AGENTS.md:84` says `{{env.*}}` values "are also masked in reports". That holds for the report's text, not for its image. A failed test writes a full-page PNG (`src/runner/executor.ts:504`), and `renderHtml()` embeds it as a base64 `data:` URI (`src/report/html.ts:146`). Nothing masks pixels (#110).

Reproduced with the demo app and no model: fill the promo field from `{{env.PROBE_SECRET}}`, fail the test, render the report. The text reads `***`. The embedded 26 KB PNG shows `HUNTER2` twice, once in the input and once in the page's own status line.

The HTML report is self-contained **so that it can be shared**: attached to a pull request, uploaded as a CI artifact, forwarded. A screenshot exists only on failure, which is exactly when a report is shared.

## What Changes

- When the run's mask holds any value, meaning the auth recipe or some test referenced `{{env.*}}`, the HTML report SHALL NOT embed failure screenshots. Each failed test SHALL instead say that its screenshot was withheld because the run handled secrets, and give the file's path, linked relative to the report.
- A run that referenced no `{{env.*}}` value is unchanged: screenshots stay embedded and the report stays self-contained.
- The report's footer SHALL describe what it actually did. Today it always says "Screenshots are embedded".
- `AGENTS.md` and the README's *Trust boundaries* SHALL say that masking covers text, not images, and what the report does about that.
- `docs/ci.md` currently tells people to upload `.blastproof/reports/`, which holds the raw PNGs. It SHALL stop recommending that by default.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `html-report`: self-containment is now conditional on the run holding no secret, and failure detail gains a withheld-screenshot form

## Impact

- New dependencies: **none**
- Affects `src/report/html.ts` (a new `HtmlMeta` field, the screenshot branch, the footer), the one `renderHtml` call in `src/commands/run.ts`, a read-only accessor on `SecretsMask`, their tests, `AGENTS.md`, `README.md` and `docs/ci.md`
- The PNG on disk, the console's `screenshot:` line and the JUnit report are unchanged
- Behaviour change for suites that use `{{env.*}}`: their shared `report.html` no longer shows the image. The file is still next to it in the session directory

## Non-goals

- **No pixel redaction.** Blanking the element a secret was typed into leaves any echo elsewhere on the page, which is the #109 shape in image form. A redaction that looks complete is worse than none
- **No opt-in to embed anyway**, for now. That needs a config key and a reason someone would choose it. Suites that use `{{env.*}}` for a non-secret, environment-varying value are the likely case. This change does not add the flag, and records it as an open question
- **Not #109.** A reformatted secret that escapes the text mask is its own defect
- **Not a live session's pixels.** An authenticated page shows account data whether or not a `{{env.*}}` value was used (e.g. `storage_state`). Withholding every screenshot of a logged-in run is a different decision
