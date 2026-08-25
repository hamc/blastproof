# Impact mapping: `routes:` and `ignore:`

Impact mapping answers one question: *given these changed files, which pages are at risk?* It is what `--impacted` selects on, and what `--fail-on-unmapped` gates on.

## The two blocks

In `.blastproof/config.yaml`:

```yaml
routes:
  "src/auth/**": ["/login"]
  "src/cart/**": ["/cart", "/checkout"]

ignore:
  - "**/*.md"
  - "docs/**"
  - ".github/**"
  - "LICENSE"
```

`routes:` is a **map**, keyed by file glob, valued by the routes that glob puts at risk. Read each line as "if this file changed, these pages are at risk".

Do not confuse it with a test's own `routes:` field, which is a **list** of routes that test covers. Same word, opposite shape.

`ignore:` is a list of globs for files that cannot affect any page.

Nothing is ignored by default. A file nobody has classified is exactly the risk `--fail-on-unmapped` exists to surface.

## What `ignore:` is for, and the line not to cross

`ignore:` means *this file cannot change what a user sees*. Documentation, licences, CI workflows, editor configuration.

It does not mean *I do not know which pages this affects*.

The distinction matters because of how the check behaves under pressure. When `--fail-on-unmapped` goes red, there are two ways to make it green:

- Add the file to `routes:` — which requires knowing which pages it can break.
- Add the file to `ignore:` — one line, works every time, silences the check for that path permanently.

The second is always cheaper, and it is always available. Taking it turns the check that exists to force classification into a check satisfied by the classification that means *do not look at this*. The suite still passes; it just stops covering the code.

**So: a path under a source directory entering `ignore:` needs a written reason in the pull request.** If the reason cannot be written, the file belongs in `routes:`.

## Write the mapping with the change, not after the check fails

Update `routes:` in the same change as the code.

The blast radius is knowledge you have while making the change and have largely lost by the time you are staring at a failing check in isolation. At that point the honest answer is a guess — and `ignore:` is the guess that always works.

## Route strings compare exactly

`/cart` and `/cart/` are different routes. A test declaring a route that no `routes:` mapping declares gets a non-fatal warning, because it contributes nothing to `--impacted` selection.

## The gap this does not close

An affected route that no test covers is **reported, never failed**. Blocking on it would punish an incomplete map rather than teach anyone to complete it. Turning that report into a test is a deliberate act: run `blastproof plan` for the route, then read what it produced.
