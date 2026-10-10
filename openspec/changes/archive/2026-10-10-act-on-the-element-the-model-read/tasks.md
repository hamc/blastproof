# Tasks: act-on-the-element-the-model-read

## 1. Snapshot (design D3)

- [x] 1.1 `captureSnapshot` uses AI mode and strips `[cursor=pointer]`; a `withoutRefs` helper for the judge and the planner. Verify with snapshot tests
- [x] 1.2 A ref index from the snapshot text: ref → role, name, inline text. Verify on AI-mode snapshots captured from the demo app

## 2. Resolution (design D1, D2, D4)

- [x] 2.1 Schema: `target` is `{ref, role, name}`; `text` removed from both schemas; prompt says to name the element by its ref
- [x] 2.2 `resolveTarget` resolves `aria-ref` only: count 0 or an invalid-frame error is "the page changed since the snapshot"; role/name disagreeing with the ref's line is refused naming both. Verify #132's and #60's demo-app shapes resolve the element read, and a neighbour's ref is refused
- [x] 2.3 Executor, auth and planner thread the ref index; the judge receives the snapshot without refs

## 3. Record (design D5)

- [x] 3.1 `describeAction`, result lines and the commit identity use the ref's role and name. Verify #124's duplicate commit is still refused when the button re-renders with a new ref
  - *Found live.* On the notes test, Haiku re-filled the form after the redirect and was refused the second click, as on `main`, but then insisted 4 runs in 5 (`main`: 0 in 5). After the reload the button had a new ref, and the refusal said only "this exact action already succeeded". The refusal now names the element and says refs are renumbered when the page changes: 5 of 5 passed

## 4. Verification (design D6)

- [x] 4.1 `npm run eval:judge` on Haiku and Luna: no regression
  - *Done.* "no regression", 3 samples, the two known #129 failures unchanged
- [x] 4.2 `npm run eval:reliability` on Haiku, Luna and gpt-oss-20b, 5 samples: false FAIL, false PASS, right step and tokens against the published numbers
  - *Haiku:* unchanged. False FAIL 0/40, false PASS 0/30 literal and 0/20 subtle, right step 47/50, as on `main`. Tokens +11% (3.60M against 3.25M)
  - *Luna:* unchanged. 0/40, 0/30, 0/20, right step 50/50. Tokens +6%. Run direct to OpenRouter: the benchmark's routing relay adds `require_parameters`, and OpenRouter found no endpoint for Luna with it (HTTP 404 on all 55 runs). That is the relay, not blastproof
  - *gpt-oss-20b:* false FAIL 11/40 against 2/40, but 8 of the 11 are one suite sample whose sign-in failed. The model clicked "Login" again after signing in, the wandering seen before. Sign-in failed in 6 of 51 runs, against 10 of 55. False PASS 2/46 against 1/50 (`no-cart-feedback`, `order-status`), both the judge passing with a reason that contradicts it. Replayed alone, 12 times each, on the old and the new snapshot format, those two pages were passed 0-1/12 in both formats: the judge's noise on this model, not the format. Right step 31/46 against 32/50
- [x] 4.3 Docs: AGENTS.md conventions, `docs/` wherever resolution is described
- [x] 4.4 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 4.5 Archive in the same pull request, as its own commit
