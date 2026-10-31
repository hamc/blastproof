## Why

`auth.steps` signs in once and seeds every test with what it captured, `context.storageState()`: cookies and local storage. An application that keeps its session anywhere else is signed in for the login and signed out for every test (#59).

- **IndexedDB.** A real budgeting app keeps its session there, with cookies, local storage and session storage all empty. Against it, the first authenticated test started on the sign-in page and spent its whole action budget trying to log in. Measured again for this change on the app's local demo: the captured state is 27 characters long, and a context seeded with it shows the start page instead of the budget.
- **Session storage.** OWASP Juice Shop keeps the basket id there. A context seeded from the captured state shows an empty basket, and adding to it writes nothing.

Nothing says so. `auth.verify` passes, because it is judged in the login's own context, where the session works. The tests that consume the session are where it fails, as N failures on a login wall that name no cause, which is exactly what `verify` exists to prevent. And the workaround, every test signing in for itself, ran into the same app's login throttle ("Too many requests").

Playwright can capture IndexedDB (`storageState({ indexedDB: true })`, since 1.51), but its capture drops any key or value that is falsy. The budgeting app's database keeps page 0 of a SQLite file under the key `0`, so the state restores with an error, `The object store uses out-of-line keys and has no key generator and the key parameter was not provided`. This is still the case in Playwright 1.64.1, the latest release.

## What Changes

- The login captures IndexedDB as well as cookies and local storage, always.
- Keys and values Playwright drops (`0`, `''`, `false`, `null`) are read back from the page the login ended on and put into the captured state.
- The login also captures session storage for the origin it ended on, and every context seeded with the session gets it back when a page of that origin loads.
- With `auth.verify`, the sign-in is checked a second time, in a fresh context seeded only with the captured session, on the page the login ended on. A session that worked for the login and does not survive capture now stops the run with exit 2 and a message saying so, instead of N failures on a login wall.
- `auth.cache` keeps the session storage too.

## Non-goals

- **Making IndexedDB capture optional.** Whoever needs it cannot know until a run has already failed, and an app with no IndexedDB costs nothing.
- **Other origins.** Session storage and the falsy-key repair cover the origin the login ended on. An identity provider's own storage is not something a test of the app reads.
- **`storage_state` files and `headers`/`cookies`.** They are not captured by blastproof, so there is nothing to repair; their files are Playwright's format and keep working.
- **Re-checking a cached session.** A cached session that expired is a separate problem with its own remedy (recapture).
- **Fixing Playwright.** The repair is local and comes out when Playwright's capture keeps falsy keys; reporting the bug upstream is worth doing and is not part of this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `authentication`: what the login captures, how a context is seeded with it, and the second verification.

## Impact

- `src/session-capture.ts` (new): capture with IndexedDB, the falsy-key repair, session storage capture and the seeding script.
- `src/auth.ts`: uses the capture, `seedContext`, the second verification, the cache.
- `src/runner/executor.ts`: `waitForSettled` is exported, so the second verification settles the page as a step does.
- `src/commands/run.ts`, `src/commands/plan.ts`: a seeded context gets the session-storage init script.
- No new dependency.
- Documentation: `docs/auth.md` (what is captured, the second check), the CHANGELOG.
