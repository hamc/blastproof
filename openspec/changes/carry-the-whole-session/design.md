## Context

`fromSteps` (`src/auth.ts`) runs the login journey in its own context, judges `auth.verify` there, and returns `{ storageState: await context.storageState() }`. `contextOptions` passes that state to `browser.newContext` for each test (`run.ts`) and each planner page (`plan.ts`). With `auth.cache`, the state is written to `.blastproof/.auth-state.json` and read back on the next run.

Playwright's `storageState()` holds cookies and, per origin, local storage. With `{ indexedDB: true }` it also holds each origin's IndexedDB databases, and `newContext({ storageState })` restores them before any page loads.

## Goals / Non-Goals

**Goals:**

- A session kept in IndexedDB or session storage reaches every test the way a cookie does.
- A session that does not survive capture is reported once, as an authentication failure, not as every test failing.

**Non-Goals:**

- An option to turn it off, other origins, other strategies, cached sessions, Playwright itself (proposal).

## Decisions

### D1. IndexedDB is always captured

`context.storageState({ indexedDB: true })`. An app without IndexedDB yields the same state as before. On the budgeting app's demo the state grows from 27 characters to about 1.3 MB, which every seeded context restores before its first page; that is the session, and a test that had none of it was testing the start page.

### D2. Repairing what Playwright drops

Playwright's collector (`StorageScript._collectDB`) keeps a key or value only `if (trivial)`, so `0`, `''`, `false` and `null` are lost. On restore it reads `record.key ?? …`, which accepts them. So the repair is on capture only.

After `storageState`, one `page.evaluate` on the page the login ended on lists, for each database and store, the record count and the position, key and value of every record whose key or value is falsy (`getAllKeys` and `getAll` return records in the same order Playwright's collector walked them). The capture then sets the missing `key` on an out-of-line store's record, and the missing `value`. `null`, `NaN` and `-0` go in Playwright's encoded form: its restore reads `record.value ?? decode(valueEncoded)`, so a plain `value: null` would come back as `undefined`. Only falsy entries cross back from the page, so a database of binary pages is not transferred twice.

The two reads are not one transaction, and the app may write between them. The repair therefore refuses when they disagree: a store whose count differs, a dropped entry the page does not report, a falsy key where the capture holds another key, a falsy value where it holds a truthy one. A refused repair captures again, up to three times, and then fails the login with an `AuthError` naming the cause.

Another origin's IndexedDB cannot be repaired from this page. If it has a dropped entry, that origin's IndexedDB is left out of the state, and the rest of its state kept: before this change no IndexedDB was captured at all, and a record with no key fails the whole context on restore.

Measured on the budgeting app: two entries, the SQLite page at key `0` and a `null` setting. Without the repair the state does not restore at all; with it the restored context opens the budget.

It is limited to the origin the login ended on, which is where the app under test keeps its data. When Playwright keeps falsy keys, the capture already holds what the page reports, the repair accepts it unchanged, and the code is inert. The unit tests pin the repair against the record shape Playwright 1.62 produces, read from a real capture (`{ "value": "page zero" }` for the key `0`, `{ "key": "empty" }` for the value `''`).

The capture lives in its own module, `src/session-capture.ts`, beside `auth.ts`: the page functions, the repair and the seeding script are self-contained and tested without a login journey.

### D3. Session storage: captured from the login's last page, seeded once per tab

Playwright does not capture session storage. The login reads `sessionStorage` from the page it ended on, with its origin. Every context seeded with the session gets an init script (`context.addInitScript`) that, in a document of that origin, writes the items into `sessionStorage` and records that it did under one marker key, `blastproof:session-seeded`.

Session storage belongs to a tab and survives its navigations, and an init script runs on every navigation. Without the marker, a key the app deliberately removed (a logout, a basket emptied) would be written back on the next page load. Seeding only keys that are absent has the same flaw. The marker is one key in the app's session storage; that is the cost, and the docs name it.

`contextOptions` stays the place that decides what a context gets: it returns the options, and a new `seedContext(context, session)` applies the init script, called right after `newContext` in `run.ts` and `plan.ts`.

### D4. The sign-in is checked where it is consumed

With `auth.verify`, and only then, after the capture, a fresh context is created with `contextOptions(session, device)` and seeded, a page goes to the URL the login ended on, waits for it to settle like any step, and `auth.verify` is judged again. A pass returns the session. A failure is an `AuthError` (exit 2, no test run):

```
Signed in, but the captured session does not keep the sign-in: a new browser context
seeded with it is not signed in (<reason>). The app may keep its session where a storage
state cannot hold it, such as memory or a service worker. Tests would start signed out,
so none were run.
```

The first judgment checks that the login worked; this one checks what the tests get. It is the guarantee `verify` was documented to give, and it was checked in one place and consumed in another, the shape `AGENTS.md` names as this codebase's recurring defect.

The URL the login ended on, not `base_url`, because the first verification passed on that page, so a second failure there is about the session, not about a different page. It costs one judgment and one page load per run, only when `verify` is configured, which the docs already sell as "worth the extra model call".

Alternative rejected: a deterministic check (compare cookies, storage keys). It cannot see a session kept in memory or a service worker, and it would pass the very case in #59, where the state was empty only for lack of IndexedDB.

### D5. The cache keeps session storage

`.auth-state.json` gains a `sessionStorage` field beside Playwright's `cookies` and `origins`. Reading it, the field is taken off before the state reaches Playwright. A `storage_state` file without it reads as before.

## Risks / Trade-offs

- [A large IndexedDB is restored into every test's context] → it is restored by Playwright before the first page, once per context; an app whose session is that database cannot be tested signed in any other way.
- [The second verification fails a run that worked before] → only where the session did not survive capture, in which case every test was failing on the login wall anyway; the message says what happened.
- [The login ends on a one-time URL, such as an OAuth callback] → apps redirect off the callback; one that does not would fail the second check, and the message points at the session, which is where to look.
- [The marker key in session storage] → one key, named in the docs; the alternative re-seeds data the app removed.

## Measured

Run with `anthropic/claude-haiku-4.5`, before and after, on the same apps.

- **The budgeting app's demo**, a test checking that the sidebar lists one of the demo budget's accounts. On `main` it fails: the test starts on the start page. With a looser check, "the sidebar lists the budget's accounts", the agent clicked "Start budgeting", created an empty budget and passed — the false PASS #59 makes possible. After the change it passes, starting inside the demo budget, in 16 s against 54 s. A build with IndexedDB capture turned off exits 2 with the second check's message.
- **Juice Shop**, a test checking the signed-in user's basket: empty and failing on `main`, three products and passing after.
- **The dogfood suite** (`auth.steps` with `verify`): 10 of 10, score 100.
- In real Chromium, with an origin holding the key `0` and the values `null`, `''` and `false`: all restored, the session storage seeded, a key the page removed not written back after a reload, and another origin not seeded.
