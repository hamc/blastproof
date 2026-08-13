# Design: refuse-an-inverted-routes-map

## Context

`routes:` is validated as `z.record(z.array(z.string()))`. That type is symmetric — it cannot tell `{ "src/cart/**": ["/cart"] }` from `{ "/cart": ["src/cart/**"] }`, because both are a string keying a list of strings. The type system has nothing left to say, so the only thing that can separate the two shapes is the *content* of the strings: a route and a repository-relative file path do not look alike.

The failure this closes is silent by construction. An inverted map matches no changed file, so `--impacted` selects nothing, the run exits 0, and the report reads exactly like a diff that affected no page.

## Goals / Non-Goals

**Goals:**
- Refuse an inverted map at load, before anything is spent
- Show the correction using the reader's own entry, not a documentation reference
- Accept every map that a correct configuration could plausibly contain

**Non-Goals:** auto-correction, a warning-only mode, catching inversions that no rule can distinguish, changing what an accepted map means.

## Decisions

### D1: Refuse, do not warn

A warning would preserve the exit code, and the exit code is the defect. The whole failure is that a broken map produces a green run; a warning on stderr next to a green run is the state we are already in, plus text.

The cost is real and worth stating: a team whose map is inverted has a passing pipeline today, and this turns it red on upgrade. That is the strongest argument against, and it loses on one fact — their pipeline is green *because it never ran a test*. Turning that red is the correction, not the regression. It does mean this cannot ship as a patch; see the version note in `proposal.md`.

Precedent is one screen up in the same file: `src/config.ts:84` refuses two auth strategies rather than preferring one, because "silently preferring one would make a typo look like it worked."

### D2: Both halves must look wrong

The key must look like a route **and** some value must look like a file. Either signal alone is not evidence:

- `"src/products/**": ["/products/*"]` — a route may legitimately hold a wildcard
- `"/src/cart/**": ["/cart"]` — a key may legitimately start with a slash if it also carries a glob

Requiring the conjunction means a false positive needs a key that reads as a route *and* values that read as source paths — which is, definitionally, the inverted map.

### D3: A route-shaped key carries no glob metacharacter

`ROUTE_SHAPED = /^\/[^*?]*$/`. `routes:` globs are repository-relative (`src/cart/**`), so a leading slash is the primary signal; excluding `*` and `?` is what keeps an absolute-looking glob out of the accusation (D2's second example).

### D4: A file-shaped value is a wildcard or **any** extension — never a known list

`FILE_SHAPED = /[*?]|\.[a-z0-9]{1,8}$/i`.

The first implementation enumerated extensions: `.ts`, `.tsx`, `.js`, `.vue`, `.svelte`, `.astro`, `.py`, `.rb`, `.go`, `.php`, `.rs`, `.java`, `.kt`, `.cs`. It was then pointed at the first real config anyone tried — **this repository's own** — whose sources are `.html`. The check passed the inverted map straight through and produced a normal-looking impact report, with the validation installed and inert.

That is worth recording as more than a bug. It is the second time enumeration has lost in this project: the authoring check in `steps-name-their-value` reached the same conclusion, that enumerating the ways to name a value cannot be closed, and asked a structural question instead. A trailing extension is the property that actually distinguishes a file from a route; the list of extensions in the world is not closeable and does not need to be.

It was also found by running the tool against a real config rather than by reading the regex — the same way `drafts-follow-the-rule` was found. Reading would not have surfaced it.

### D5: Detection is a pure exported function, refined into the schema field

`findInvertedRouteEntries(routes)` is exported and unit-testable on its own; the `superRefine` on the `routes` field turns its result into a `ctx.addIssue`, so the message flows out through `loadConfig`'s existing `ConfigError` path and reads like every other config error. Same construction as `authSchema`.

`findUnknownConfigKeys` is unaffected: `unwrapToObjectSchema` unwraps the new `ZodEffects` and stops at the `ZodRecord`, which is not a `ZodObject`, so route globs are still never reported as unknown keys.

### D6: Name one entry, count the rest

```
routes: is the wrong way round (and 1 more) — the key is the file glob, the value is the routes it affects.
      found:    "/cart": ["src/cart/**"]
      expected: "src/cart/**": ["/cart"]
```

A fully inverted map of ten entries produces one worked example rather than ten. The `found`/`expected` pair is built from the reader's own data, so the correction needs no documentation lookup — the fix is visible in the error.

## Rejected alternatives

- **A1 Warn instead of refusing** — leaves the green exit code that is the defect (D1).
- **A2 Enumerate known source extensions** — measured failure: missed `.html` and let this repository's own inverted config through (D4).
- **A3 One-sided rule (key looks like a route)** — flags `"/src/cart/**": ["/cart"]`, a valid map (D2).
- **A4 Swap the entry automatically** — makes a typo look like it worked, the thing `src/config.ts:84` exists to refuse.
- **A5 Detect in `impact.ts` when mapping runs** — too late: the browser has launched and the run has begun. Config problems belong at config load.
- **A6 Require the key to match a stricter glob grammar** — rejects legitimate globs nobody has thought of yet, and puts the burden on correct configs rather than on broken ones.

## Risks / Trade-offs

- **A previously-loading config now exits 2.** Only ever a config that matched nothing (D1). Mentioned in the changelog as behaviour-changing, and released as a minor.
- **Inversion with no leading slash is not caught** — `{"cart": ["src/cart/**"]}`. No rule separates that from a valid glob mapped to oddly-named routes. Accepted; the common shape is the one users actually write.
- **A route ending in something extension-like** — `{"/cart": ["/v1.0"]}` would be flagged. Both halves are routes, so the config is meaningless in either direction; refusing it is not a loss.

## Migration Plan

No migration for any working configuration. A config refused by this check never mapped a file to a route, so nothing that functioned stops functioning. The error names the entry and shows the corrected form.

## Open Questions

(none)
