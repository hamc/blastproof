# Design: match-the-name-the-model-named

## Context

`resolveTarget` builds up to three candidates — `getByRole(role, {name})`, `getByLabel(name)`, `getByText(text ?? name)` — and returns the first whose `.first()` becomes visible within the configured timeout.

Two defaults do the damage, and neither is written down anywhere a user reads. Playwright's `name` option matches by substring, case-insensitively, unless `exact: true` is passed. And `.first()` resolves ambiguity by DOM order, silently.

The prompt has told the model to use the exact accessible name since the executor was written. The resolver has never asked for one.

## Goals / Non-Goals

**Goals:**
- A page that offers a unique accessible name is driven by that name, not by a longer one that happens to contain it
- A name that answers to several visible controls stops being resolved by DOM order
- A suite that works today keeps working

**Non-Goals:** rescuing a page that genuinely has no unique name for the control (D5), normalization, a selector fallback, prompt changes.

## Decisions

### D1: Exact first, loose as fallback — within each strategy, not across them
The chain stays as it is and each strategy tries exact then loose *within itself*, in order: role-exact, role-loose, label-exact, label-loose, text-exact, text-loose.

The alternative — all three exact, then all three loose — sounds tidier and is wrong: it lets a *text* exact match beat a *role* match, and the role match is the one carrying the model's own reading of the snapshot. Strategy order is the stronger signal and stays outermost.

A straight swap to `exact: true` with no fallback was rejected outright. It turns a working step into `Element not found` for anyone whose snapshot text differs from the accessible name by whitespace or truncation — a regression delivered to every existing user in exchange for a defect most of them have not hit.

### D2: Ambiguity is refused, not guessed — and only among visible elements
When a candidate matches more than one **visible** element, the action fails with a message naming the count, rather than `.first()` picking one. The model then re-decides with a fresh snapshot and can name something more specific; the refusal costs one attempt against the existing per-step retry budget.

The precedent is the repeated-commit refusal (`A step does not repeat a commit it already performed`): a resolver that declines and explains is better than one that guesses, and the cost of declining is already budgeted for.

`visible` is load-bearing and not a detail. A real application carries hidden duplicates constantly — a closed dropdown's options, an off-screen mobile nav, a modal not yet opened. Counting raw matches would refuse actions that are not ambiguous at all to a user, which is the expensive direction of error. Playwright's `filter({ visible: true })` is the same predicate resolution already waits on.

### D3: Ambiguity is refused wherever it occurs, exact or loose
The refusal fires whenever a candidate answers to more than one visible element — on the exact attempt and on the loose fallback alike.

**This reverses the first version of this decision, which refused only on the exact path.** The reasoning there was that refusing on the fallback would break the forgiving behaviour D1 exists to preserve. That conflated two different things. Forgiveness is a loose match finding **one** element — a name differing by whitespace or truncation. Guessing is a loose match finding **several**. Refusing the second does not touch the first.

Worse, the first version left the most common shape of this defect completely unguarded, because substring ambiguity is by its nature a *loose*-match phenomenon. Measured on a page with `Salvar o arquivo como PDF` and `Salvar o arquivo e sair`, against the name `Salvar o arquivo`:

| attempt | matches | visible |
|---|---|---|
| `getByRole('button', { name: 'Salvar o arquivo', exact: true })` | 0 | 0 |
| `getByRole('button', { name: 'Salvar o arquivo' })` | 2 | 2 |

Exact finds nothing, the fallback finds two, and under the first version `.first()` picked one in silence — the exact defect #60 describes, surviving the change meant to fix it.

The false positive that motivated the first version was measured and does not exist. Playwright matches the **smallest** element containing the text, so a `<div><p><span>` nesting counts once, not three times:

```
getByText('Salvar o arquivo', { exact: true })  ->  2 matches: SPAN, LABEL
```

Two genuinely distinct elements, not one element counted twice. There is no nesting inflation to protect against.

What remains true from the first version is `visible`: hidden duplicates are real and must not count (D2).

### D4: The interfaces widen, and that is the real cost
`PageLike.getByRole` takes `{name?}` only; `getByLabel` and `getByText` take a bare string; `LocatorLike` has no `count()` and no `filter()`. All three need widening, and the four test files implementing them (`actions`, `auth`, `containment`, `executor`) need updating.

Worth stating in the proposal rather than discovering in review: the diff is larger than the behaviour change, and most of it is doubles. `PageLike` is *implemented* by every double rather than passed as options, deliberately — the comment on `waitForLoadState` explains why — so widening it is loud, which is the property we want.

### D5: What this does not fix, said in the change rather than found later
Both witnesses in #60 survive this change:

- `Create` against a page offering only `Create a local account` — exact finds nothing, the loose fallback resolves it exactly as today
- `Payee` naming a row cell when the column header is the only button with that name — exact matches the header, uniquely

Neither is a matching defect. The page has no unique accessible name for the control the model wants, and no rule can conjure one. The honest answer is #60's own: *the page cannot be driven unambiguously*, which is a finding for the user, not something for the resolver to paper over. The obstruction half of the first witness is already handled by `name-what-blocks-the-click`.

Writing this down is the point of the change having a design. A reader who assumes the witnesses are fixed will measure the wrong thing and conclude the fix failed.

## Rejected alternatives

- **`exact: true` with no fallback** — regresses every suite relying on the loose match, knowingly or not (D1)
- **Normalizing whitespace and case before comparing** — reintroduces the widening this change removes, with a bespoke rule instead of Playwright's
- **Naming the rival candidates in the refusal** — attractive, and it puts page content into a message that does not pass through the secrets mask. Deferred until that path is checked; the count alone is enough for the model to re-decide
- **Counting all matches rather than visible ones** — refuses actions that are unambiguous to a user (D2)
- **Refusing only when the *exact* match is ambiguous** — the first version of D3, reversed after measurement: it leaves the substring case, which is the defect in #60, entirely unguarded (D3)
- **A CSS/XPath escape hatch for ambiguous names** — the absence of one is the product

## Risks / Trade-offs

- **`count()` adds a round trip per resolution attempt.** Bounded and small next to the model call it follows, but it is on the hot path and should be measured, not assumed.
- **A page with two visible controls answering to one name now fails where it previously acted.** This is the largest risk in the change and it grew with D3: refusing on the loose fallback means any suite whose step names a prefix of two controls stops working, where today `.first()` sometimes lands on the right one. That is luck, and luck that silently clicks the wrong control is the whole of #60 — but it will be experienced as a regression by whoever was lucky. Task 5.3 measures it against the demo suite before this ships.
- **Exact-first changes which element is chosen** on any page where both an exact and a longer loose match exist. That is the fix, and it is also the only way this can surprise someone.

## Migration Plan

No config, no flag, no file format. Behaviour differs only on pages where the two matches disagree.

## Open Questions

- **Does `filter({ visible: true })` interact badly with the visibility wait already in the loop?** Resolution waits for `.first()` to become visible; counting visible matches *before* that wait can see zero on a page still settling. Order of operations needs deciding in implementation — most likely wait first, count after.
- **Should an ambiguous name be surfaced to the user as a page finding, not only to the model?** #60 argues yes, and it is the more valuable half. Out of scope here; worth its own change once this one is measured.
