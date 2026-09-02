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

**Non-Goals:** rescuing a page that genuinely has no unique name for the control (D5), widening what the resolver knows about a target beyond role and name (D7), normalization, a selector fallback, prompt changes.

## Decisions

### D1: Exact first, loose as fallback — within each strategy, not across them
The chain stays as it is and each strategy tries exact then loose *within itself*, in order: role-exact, role-loose, label-exact, label-loose, text-exact, text-loose.

The alternative — all three exact, then all three loose — sounds tidier and is wrong: it lets a *text* exact match beat a *role* match, and the role match is the one carrying the model's own reading of the snapshot. Strategy order is the stronger signal and stays outermost.

A straight swap to `exact: true` with no fallback was rejected outright. It turns a working step into `Element not found` for anyone whose snapshot text differs from the accessible name by whitespace or truncation — a regression delivered to every existing user in exchange for a defect most of them have not hit.

### D2: Ambiguity is refused, not guessed — counted among visible elements
When a candidate matches more than one **visible** element, the action fails with a message naming the count, rather than `.first()` picking one. The model then re-decides with a fresh snapshot and can name something more specific; the refusal costs one attempt against the existing per-step retry budget.

The precedent is the repeated-commit refusal (`A step does not repeat a commit it already performed`): a resolver that declines and explains is better than one that guesses, and the cost of declining is already budgeted for.

**What `visible` does and does not do, measured rather than assumed.** The first draft of this decision claimed the filter was load-bearing across the board. Playwright 1.62, one visible control and one duplicate hidden four different ways, `name` matched exactly:

| how the duplicate is hidden | `getByRole` all / visible | `getByText` all / visible |
|---|---|---|
| `hidden` attribute | 1 / 1 | 2 / 1 |
| `display: none` | 1 / 1 | 2 / 1 |
| `visibility: hidden` | 1 / 1 | 2 / 1 |
| closed `<details>` | 1 / 1 | 2 / 1 |
| `.sr-only` (`clip-path: inset(50%)`, 1px) | **2 / 2** | **2 / 2** |
| absolutely positioned off-screen | **2 / 2** | **2 / 2** |

Two things follow, and neither was in the first draft.

**The filter is nearly redundant on the role strategy.** `getByRole` reads the accessibility tree, which already excludes everything hidden the four ordinary ways. It earns its place on `getByLabel` and `getByText`, which match DOM nodes regardless. Keep it on all three — the cost is one round trip and the asymmetry is not worth encoding — but the justification is the text strategy, not the role one.

**The filter does not catch the case that matters most to this project's audience.** The canonical `.sr-only` pattern keeps a real box, so Playwright calls it visible and both strategies count it. A page that gives a visible control an accessible-name twin for screen readers would now be refused where today it acts. That is a false positive landing precisely on people who wrote accessible markup — the only people blastproof works for at all.

**Measured against real accessible sites, and the refusal did not survive it.** Task 0.1 asked how often a screen-reader twin shares a visible control's exact role and accessible name. Playwright's own locator, `exact: true`, `filter({ visible: true })`:

| page | sampled name | all / visible | the refusal would |
|---|---|---|---|
| gov.uk | `link "Benefits"` | 2 / 2 | **refuse** |
| gov.uk | `link "Business and self-employed"` | 2 / 2 | **refuse** |
| gov.uk | `link "Driving and transport"` | 2 / 2 | **refuse** |
| github.com | `link "Pricing"` | 2 / 2 | **refuse** |
| github.com | `link "Sign in"` | 1 / 1 | resolve |
| developer.mozilla.org | `link "Learn web development"` | 1 / 1 | resolve |

Sweeping gov.uk's whole page: 25 accessible names are shared by two elements of the same role, and 22 of those pairs contain a twin whose box is 1px or less. This is not an exotic case; it is how a responsive accessible site is built.

The refusal would therefore refuse ordinary navigation on the reference example of accessible markup — against the only audience blastproof works for at all. **D2 and D3 are not implemented.** `.first()` still resolves an ambiguous name by document order, as before, and that remains a real defect: unfixed, and now measured.

The gate in task 0.2 did its job. This is the outcome it existed to produce, rather than a discovery made after shipping.

### D3: Ambiguity is refused wherever it occurs, exact or loose — *not implemented*
The refusal fires whenever a candidate answers to more than one visible element — on the exact attempt and on the loose fallback alike. **Superseded by the measurement in D2: this half of the change did not ship.** The reasoning below stands and is kept because it is what the next attempt has to beat.

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

### D6: The refusal carries the rule, not only the count — *not implemented, ships with the refusal*
The message is read by the model, not by a person — it is the whole feedback loop this decision creates. So it states the count *and* what to do about it: give the shortest name that identifies this control on its own.

A count alone tells the model that something is wrong and leaves it to guess the remedy; on a page with several similar controls the natural guess is to try a *different* control, which is the wrong move and spends another attempt. Naming the rule turns a refusal into an instruction, at no cost in bytes that matters.

The message carries **no page text** — the count and the rule only. Naming the rival candidates would be more useful and would put page content into a string that does not pass through the secrets mask. Deferred until that path is checked (see rejected alternatives).

### D7: The real limit is that resolution has one signal
A role and an accessible name are all this resolver knows about a target. That is why ambiguity is unresolvable here: three `Excluir` buttons in three table rows are genuinely indistinguishable to a matcher that sees only role and name, and no rule over that pair separates them.

Refusing is the correct answer *given one signal*. It is not the correct answer in general — a resolver that also knew the target's position, its enclosing structure, or its appearance would resolve most of these without asking the model anything.

The measurement in D2 turns this from an observation into the conclusion of the whole change. Stating it changes what the `.sr-only` false positive is. It is not a bug in the counting rule to be patched with a better visibility predicate; it is the same one-signal limit showing up from the other side — two elements that share a role and a name and differ only in a signal we do not read. Widening the signal set is a change of its own and belongs in an issue, not in a heuristic bolted onto this one.

## Rejected alternatives

- **`exact: true` with no fallback** — regresses every suite relying on the loose match, knowingly or not (D1)
- **Normalizing whitespace and case before comparing** — reintroduces the widening this change removes, with a bespoke rule instead of Playwright's
- **Naming the rival candidates in the refusal** — attractive, and it puts page content into a message that does not pass through the secrets mask. Deferred until that path is checked; the count alone is enough for the model to re-decide
- **Counting all matches rather than visible ones** — refuses actions that are unambiguous to a user (D2)
- **Refusing only when the *exact* match is ambiguous** — the first version of D3, reversed after measurement: it leaves the substring case, which is the defect in #60, entirely unguarded (D3)
- **A CSS/XPath escape hatch for ambiguous names** — the absence of one is the product
- **A stricter visibility predicate to exclude `.sr-only`** — a minimum box area, or an in-viewport test, would exclude the 1px clipped element and would be a heuristic invented to dodge a symptom. It would also start refusing genuinely visible small controls (an icon button). The honest framing is D7's
- **Matching loosely by default, with exactness opted into per step** — the sensible default when the target is *described by a person*, because a loose match absorbs the author's typos. It does not transfer here: our name is an accessible name **transcribed from the snapshot by the model**, so there is no human typo to forgive, and the instruction already tells the model to give the name exactly. Defaulting to loose would mean widening a name that was never approximate to begin with

## Risks / Trade-offs

- ~~**A page with two visible controls answering to one name now fails where it previously acted.**~~ Removed with the refusal (D2). It was the largest risk in the change, and measuring it is what stopped the change from carrying it.
- ~~**`count()` adds a round trip per resolution attempt.**~~ Gone with the refusal: nothing counts any more.
- **Exact-first changes which element is chosen** on any page where an exact and a longer loose match both exist. That is the fix, and it is the only way what shipped can surprise someone.
- **The defect in #60 is half closed, and the report still cannot say which half.** A name answering to several controls is resolved by document order exactly as before. The issue stays open.

## Migration Plan

No config, no flag, no file format. Behaviour differs only on pages where the two matches disagree.

## Open Questions

- **Does `filter({ visible: true })` interact badly with the visibility wait already in the loop?** Resolution waits for `.first()` to become visible; counting visible matches *before* that wait can see zero on a page still settling. Order of operations needs deciding in implementation — most likely wait first, count after.
- **Should an ambiguous name be surfaced to the user as a page finding, not only to the model?** #60 argues yes, and it is the more valuable half. Out of scope here; worth its own change once this one is measured.
- ~~**What happens to a page carrying `.sr-only` twins of visible controls?**~~ Answered by measurement, and it changed what ships (D2). The argument for accepting the refusal — that an `.sr-only` twin of a *visible* control's exact role and name is rarer than it sounds — is false: 22 such pairs on a single page of gov.uk. The refusal is out. What stays open is its successor: **how does the resolver come to know more than a role and a name?** That is D7's question and needs a change of its own.
- **Is a stricter visibility predicate worth revisiting now?** It was rejected as a heuristic invented to dodge a symptom, and the measurement makes it look more necessary without making it more principled. Recorded rather than reopened: it would still refuse a genuinely small visible control, and it would still leave two full-size twins ambiguous.
