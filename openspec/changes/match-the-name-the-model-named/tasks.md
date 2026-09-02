# Tasks: match-the-name-the-model-named

## 1. Widen the interfaces

- [ ] 1.1 `PageLike`: `getByRole(role, options?: { name?: string; exact?: boolean })`, `getByLabel(text, options?: { exact?: boolean })`, `getByText(text, options?: { exact?: boolean })`
- [ ] 1.2 `LocatorLike`: `count(): Promise<number>` and `filter(options: { visible?: boolean }): LocatorLike`
- [ ] 1.3 Update the four test doubles (`tests/actions.test.ts`, `tests/auth.test.ts`, `tests/containment.test.ts`, `tests/executor.test.ts`). Widening `PageLike` is deliberately loud (design D4) — a double that cannot express exactness cannot support this guarantee

## 2. Exact first, loose as fallback

- [ ] 2.1 `resolveTarget`: each strategy tries exact then loose, strategy order unchanged (design D1)
- [ ] 2.2 Unit test: a page offering both `Add` and `Add New`, with `Add New` first in DOM order, resolves `Add` to `Add` — this is the silent wrong-element case, and it fails before the change
- [ ] 2.3 Unit test: a name that matches nothing exactly still resolves through the loose fallback, so today's forgiving behaviour survives
- [ ] 2.4 Unit test: strategy order still beats match precision — a role match wins over a text exact match

## 3. Refuse an ambiguous name

- [ ] 3.1 Refuse when a match — exact attempt or loose fallback — answers to more than one **visible** element, naming the count (design D2/D3)
- [ ] 3.2 Settle the ordering question from the design's open questions — wait, then count — and write the answer into the code comment
- [ ] 3.3 Unit test: two visible controls sharing a name refuse, and the message names the count
- [ ] 3.4 Unit test: one visible and three hidden controls sharing a name resolve normally — the hidden-duplicate case is the expensive false positive
- [ ] 3.4a Unit test: `Salvar o arquivo` against `Salvar o arquivo como PDF` and `Salvar o arquivo e sair` — exact finds nothing, loose finds two, refused. This is the shape the first version of D3 left unguarded
- [ ] 3.4b Unit test: a loose match with exactly one candidate still resolves, so forgiveness survives the refusal
- [ ] 3.5 Unit test: the refusal spends one attempt and the model re-decides, rather than ending the step outright
- [ ] 3.6 Confirm the refusal message carries no page text, only a count (design: rejected alternatives)

## 4. Documentation

- [ ] 4.1 `README.md` — the "by role, by label, by visible text" promise says how the name is compared, and what happens when it is ambiguous
- [ ] 4.2 Record in the docs that a page with no unique accessible name for a control cannot be driven unambiguously (design D5), rather than leaving it to be discovered as a wrong verdict

## 5. Verification

- [ ] 5.1 Mutation: drop `exact` from the role strategy and confirm 2.2 fails
- [ ] 5.2 Mutation: restore `.first()` in place of the ambiguity refusal and confirm 3.3 fails
- [ ] 5.3 Live against `examples/demo-app`: the full suite still passes, unchanged. This is the regression that matters — every step in it resolves through this function, and D3's risk is that a step relying on `.first()` landing well now refuses
- [ ] 5.4 Live against a page with a real prefix collision, measuring which element is clicked before and after
- [ ] 5.5 Measure the `count()` round trip on the hot path (design risk), or record that it was not measurable next to the model call
- [ ] 5.6 `npm run build`, `npm run typecheck`, `npm test`
