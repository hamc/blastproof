## 1. Reproduce both escapes first

- [x] 1.1 Stand up two local origins so that "another origin" is real, not simulated: an application server and a second server representing anywhere else.
- [x] 1.2 A test whose step navigates to a path on the application that answers `302` to the other origin.
- [x] 1.3 A test whose step clicks a link whose `href` points at the other origin.
- [x] 1.4 Run both with a real model and **confirm where the browser ended up**, not what the tool reported.
- [x] 1.5 Report before continuing. Write no fix in this group.

### Findings

Both escaped, against 0.7.0, `anthropic/claude-haiku-4.5`, nothing in `allowed_origins:`:

| step | ended up at | reported |
|---|---|---|
| `navigate to /away` (`302` → `:4196`) | `http://localhost:4196/` | PASS |
| `click the "Partner portal" link` | `http://localhost:4196/` | PASS |

`Score: 100` for both. The click case is wider than #3 as filed: `assertAllowedOrigin` is called only in the `navigate` branch, so a click across origins is not checked at all. In the redirect run the judge named the foreign URL in its own reason and the run still passed.

### Fix verification

Both escapes now fail with the boundary message, naming `http://localhost:4196`:

```
-> click link "Partner portal" :: ok: clicked role=link name="Partner portal"
X step failed: The page left the application: http://localhost:4196/ is outside
  http://localhost:4197. Add it to allowed_origins in .blastproof/config.yaml
  if the app legitimately spans hosts.
```

## 2. One comparison, two callers

- [x] 2.1 Extract the allowed-set construction and origin comparison in `src/runner/actions.ts` behind one exported function (design D3). No second implementation of the rule.
- [x] 2.2 The `navigate` branch keeps calling it before `page.goto`, with the message it produces today unchanged.
- [x] 2.3 `about:blank` passes; every other URL must match by origin, including non-HTTP schemes (design D2). "No origin to compare" must not mean "allowed".

## 3. The boundary holds where the page is

- [x] 3.1 In `src/runner/executor.ts`, after the settle wait and **before** `takeSnapshot`, fail the step when the current URL is outside the boundary (design D1).
- [x] 3.2 No snapshot of an out-of-bounds page is taken, so its content never reaches a prompt. Assert this directly — it is the property that matters, not the failure itself.
- [x] 3.3 The failure reason names the origin and points at `allowed_origins:`, consistent with the existing pre-navigation message.
- [x] 3.4 One place decides this for every action. Do not enumerate the actions that can navigate — that is the same mistake this change exists to fix, moved somewhere new.
- [x] 3.5 `src/auth.ts`'s login journey runs through the same loop; confirm it is covered by the same line and needs no separate check.
  - Covered, and it showed immediately: seven `auth.test.ts` tests failed on a fake page returning `http://localhost/account` while `base_url` was `http://localhost:4173` — a different origin. Fixture artefact, not a product failure (a real page URL always carries the port, as the other fake in the same file already did). Fixed the fixture, not the check.

## 4. Tests

- [x] 4.1 A page that has moved to a foreign origin fails the step before any snapshot is taken.
- [x] 4.2 The foreign page's content never reaches the brain — assert against the prompts the brain received, not only the step's status.
- [x] 4.3 An origin listed in `allowed_origins:` passes the post-navigation check.
- [x] 4.4 `about:blank` passes.
- [x] 4.5 A `file:` URL fails.
- [x] 4.6 The existing pre-navigation rejection still behaves exactly as before, message included.

## 5. Verification against the reproduction

- [x] 5.1 Re-run both reproductions from group 1 with a real model. Both must fail, naming `http://localhost:4196`.
- [x] 5.2 Add the foreign origin to `allowed_origins:` and confirm both then pass — the escape hatch works, so a legitimately multi-origin application is not stranded.
  - Declared, the boundary stops blocking: the click test passes, and the redirect test reaches the foreign origin repeatedly with no boundary error. So the hatch works and a multi-origin application is not stranded.
  - The redirect test still fails, on something else and pre-existing: the judge will not accept a redirect as satisfying a step that names a path. *"The current URL is http://localhost:4196/ rather than http://localhost:4197/away."* Confirmed pre-existing from this change's own group 1 log, where the identical complaint appears against 0.7.0 (it happened to recover on the retry there). Filed separately rather than fixed here — it is the navigation analogue of "the action erases its own evidence" and deserves its own reproduction.
- [x] 5.3 Dogfood suite unchanged.
- [x] 5.4 The behavioural change is stated plainly where a user will meet it: a suite that was quietly testing a foreign page now fails. Written into the README's containment section. The changelog entry belongs to the release, not to this pull request (CONTRIBUTING).
