# Design: withhold-a-screenshot-that-saw-a-secret

## Context

The mask has one channel it cannot reach, and the report picks it up without asking.

```ts
// src/runner/executor.ts:504: the capture, on failure only
await page.screenshot({ path: file, fullPage: true });

// src/report/html.ts:146: the embed, unconditional
if (failed && result.screenshot) {
  const embedded = await embedScreenshot(result.screenshot);
```

I read these rather than assumed them, and each one shapes the design:

**The run already knows whether it holds a secret.** `buildRunMask` (`src/commands/run.ts:157`) seeds one `SecretsMask` for the whole run, from the auth recipe and every loaded test. The mask is empty exactly when nothing referenced `{{env.*}}`. No new analysis is needed, only a way to ask the mask whether it is empty.

**`renderHtml` has one production caller.** `src/commands/run.ts:415`, where both the mask and the report's target path are in scope.

**The capture is not the leak.** The PNG sits in `.blastproof/reports/<session>/`, which is git-ignored, and the console only prints its path. The leak happens when the image travels inside the file people share. The JUnit report carries no screenshot.

**Our own docs send the PNGs to the artifact bucket.** `docs/ci.md:135` recommends uploading `report.html` *and* `.blastproof/reports/`. Withholding the image from the HTML fixes nothing for someone who follows that snippet, so the snippet is part of this change.

## Goals / Non-Goals

**Goals:**
- The shareable HTML report carries no pixels from a run that handled a secret
- The evidence stays one click away for whoever ran it, not deleted
- The docs say what is masked and what is not, where someone deciding to share a report will read them

**Non-Goals:** the capture itself, JUnit, the console, and any attempt to make a screenshot safe (see Rejected alternatives).

## Decisions

### D1: The condition is the run's mask, not the failed test's own placeholders
A screenshot is withheld when the run's mask is non-empty, even if the failed test itself referenced no `{{env.*}}`.

This is the same reasoning `buildRunMask` already records as its design D1: a secret is dangerous for as long as it lives in the session. The login credential is typed once and then echoed by the authenticated page during *any* later test (an email in a header, a username in a menu). A per-test condition would embed exactly those screenshots.

Cost, stated plainly: any suite whose `auth.steps` uses `{{env.TEST_PASSWORD}}` withholds every screenshot. That is most suites with a login. See Risks.

### D2: `renderHtml` takes a decision, not a mask
```ts
screenshots: 'embed' | { withheldRelativeTo: string };
```
A required field on `HtmlMeta`. `run` computes it from the mask and from the directory the report is written to. `html.ts` never sees a secret or a `SecretsMask`, and has no reason to.

It is **required**, not optional, for the reason `AuthenticateOptions.mask` and `createBrain`'s `budget` are: an optional field defaults to the unsafe branch, so a future caller that forgets it silently embeds. The union also forces whoever withholds to say where the link is relative to, so no withheld screenshot ends up with a path nobody can resolve.

### D3: Withheld means never read
When withholding, `renderHtml` does not call `embedScreenshot` at all. It builds the link from the path string. So no later edit to the branch can put the bytes back in by accident, and the test can assert on it directly: the report contains no `data:` URI and no base64 of the fixture's bytes.

### D4: The link is relative to the report and uses forward slashes
`path.relative(reportDir, screenshot)`, normalised to `/`, HTML-escaped, in an `<a href>`. It is not `file://` plus an absolute path, for two reasons: that would put a home directory into a shared file, and it breaks the moment the report moves. With the default `--html`, the report and the PNG share a directory and the link is just the file name. With `docs/ci.md`'s upload layout, the relative link still resolves inside the downloaded artifact.

A link is not an external reference under the *No external requests* scenario. Nothing is fetched when the page opens.

### D5: The footer tells the truth in both branches
The fixed footer, *"Screenshots are embedded, so this file works offline"*, is only correct in one branch. It becomes one of two sentences, chosen from the same `screenshots` value.

### D6: `docs/ci.md` stops uploading the PNGs by default
The snippet uploads `report.html` only. A note right below it says that adding `.blastproof/reports/` uploads the raw screenshots, which are not masked, and is only reasonable for a private artifact store.

## Rejected alternatives

- **Redact pixels.** Blank the boxes of elements filled from `{{env.*}}`. Covers the input field and misses every echo, which is the case the issue reproduced (the status line). A redaction that looks complete teaches people to trust it.
- **Always link, never embed.** Fixes the leak by removing self-containment for suites that hold no secret and gain nothing from it.
- **Documentation only.** Changes a false sentence into a true one and leaves the leak shipping by default.
- **Per-test condition.** See D1.
- **An opt-out flag now.** See Open Questions.

## Risks / Trade-offs

- **Most authenticated suites lose the inline image.** → The report says why and links to the file, and the file is where it always was. A reader on the machine that ran it, or with the artifact downloaded, is one click from it.
- **`{{env.*}}` used for a non-secret value (a tenant slug, a region) triggers withholding too.** The mask cannot tell the two apart and does not try (the README's #87 paragraph is the same limitation from the other side). → Accepted for now. This is the case the open question below exists for.
- **Someone keeps uploading `.blastproof/reports/`.** → D6 changes the default snippet and says what the directory contains. Nothing in the tool can stop an upload step.

## Migration Plan

None required. For suites that use `{{env.*}}`, the visible change is a link where an image was. Rollback is reverting one branch in `html.ts`.

## Open Questions

- **Should a suite be able to say "embed anyway"?** Probably a config key rather than a flag, for the non-secret `{{env.*}}` case. It is additive, changes none of the specs above, and is worth doing once someone asks for it with a real suite.
