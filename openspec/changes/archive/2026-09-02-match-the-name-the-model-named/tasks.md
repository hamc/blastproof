# Tasks: match-the-name-the-model-named

## 0. Settle before implementing

- [x] 0.1 Measured the `.sr-only` case against real accessible applications, not a fixture. gov.uk: 25 accessible names shared by two same-role elements, 22 with a 1px twin; `link "Benefits"`, `link "Business and self-employed"` and `link "Driving and transport"` each `all=2 visible=2`. github.com: `link "Pricing"` 2/2, `link "Sign in"` 1/1. developer.mozilla.org: 1/1 on both sampled (design D2)
- [x] 0.2 **Decided: the refusal does not ship.** It would refuse ordinary navigation on the reference example of accessible markup, against the only audience the tool works for. Sections 3 and parts of 1 are cut; section 2 is unaffected and ships alone (design D2/D7)

## 1. Widen the interfaces

- [x] 1.1 `PageLike`: `getByRole(role, options?: { name?: string; exact?: boolean })`, `getByLabel(text, options?: { exact?: boolean })`, `getByText(text, options?: { exact?: boolean })`
- [x] 1.2 ~~`LocatorLike`: `count()` and `filter()`~~ — not needed once the refusal was cut. Nothing counts
- [x] 1.3 The four test doubles needed no change: each returns one locator regardless of options, which is why a name-aware double had to be written for section 2 (`pageOf` in `tests/actions.test.ts`)

## 2. Exact first, loose as fallback

- [x] 2.1 `resolveTarget`: each strategy tries exact then loose, strategy order unchanged (design D1)
- [x] 2.2 Unit test: `Add New` first in document order, `Add` targeted, resolves to `Add` — the silent wrong-element case
- [x] 2.3 Unit test: a name matching nothing exactly still resolves through the loose fallback
- [x] 2.4 Unit test: strategy order beats match precision — a loose *role* match wins over an exact *text* match, so a step naming a field does not resolve to the heading above it
- [x] 2.5 Unit test: every strategy asks for the exact match before the loose one, in order

## 3. Refuse an ambiguous name — *cut by task 0.2*

- [x] 3.1 Not implemented. A unit test pins the surviving behaviour instead: an ambiguous name resolves in document order, with the reason it was not refused written beside it

## 4. Documentation

- [x] 4.1 `README.md` — the accessibility section says the name is matched exactly first, then by substring, and that the first control wins when several share a name
- [x] 4.2 Recorded that a page whose controls do not carry distinct accessible names cannot be driven unambiguously, in the README and in the skill's enforcement table
- [x] 4.3 `skills/blastproof/SKILL.md` — the accessibility contract gains the uniqueness clause; `references/authoring.md` gains the row, marked not enforceable, naming what changed and what did not

## 5. Verification

- [x] 5.1 Mutation: dropped `exact` from the role strategy — 2.2 and 2.5 fail, the other 10 pass
- [x] 5.2 ~~Mutation on the ambiguity refusal~~ — nothing to mutate
- [x] 5.3 Live against `examples/demo-app`, real browser, `claude-haiku-4.5` via OpenRouter: **8 passed, 0 failed, Score 100, 92 model calls, 152,174 tokens.** The dogfood on the commit before this one ran the same 8 tests in 93 calls, so nothing regressed
- [x] 5.5 Live against OWASP Juice Shop 20.2.0, a real application: basket journey **PASS** (363.6s), search journey PASS after the step was corrected (231.5s). Exact-first resolved every target, including `role=button name="dismiss cookie message" text="Me want it!"`, where the accessible name and the visible text disagree — the case the fallback chain exists for
- [x] 5.6 Measured ambiguous names on Juice Shop's landing page: **zero** names answered by two visible same-role elements. The `.sr-only` false positive that cut the refusal is site-dependent, not universal — which does not change the verdict, since gov.uk is the reference for accessible markup and it fails, but the sample is worth recording as uneven
- [x] 5.4 ~~Live against a page with a real prefix collision~~ — superseded by 0.1, which measured real pages directly
- [x] 5.7 `npm run build`, `npm run typecheck`, `npm test`
