## 1. Reproduce first, and find the real trigger

- [x] 1.1 A same-origin redirect (`/away` → `/destination`) and a cross-origin one (`/away` → another host), identical destination content, same step, same model. Run each several times — the issue reports this as unstable, so one run of each proves nothing.
- [x] 1.2 State the trigger from the measurement, not from the issue's wording.
- [x] 1.3 Report before continuing. Write no fix in this group.

### Findings

| `/away` redirects to | runs | outcome |
|---|---|---|
| `/destination`, same host | 3 | **all pass** |
| `http://localhost:4194/`, another host | 3 | **all fail** |

**The trigger is the host changing, not the redirect.** The issue says "a step naming a path fails when that path redirects", which is too broad — and the sharper version matters, because the same-origin arm passing is the judge tolerating a smaller discrepancy rather than being right. Judge's own words: *"The current URL is http://localhost:4194/ instead of the expected http://localhost:4195/away, indicating the navigation did not occur."* It did occur, was reported `ok`, and was retried and failed twice more.

A first attempt at a clean reproduction used a same-origin redirect and **passed**. It was left alone rather than adjusted until it failed; the cross-origin arm is what reproduces, and knowing which is which is the finding.

## 2. A navigation says where it landed

- [x] 2.1 In `src/runner/actions.ts`, compare `page.url()` after `goto` with the requested URL; when they differ, the result names both (design D1).
- [x] 2.2 A navigation that does not redirect produces exactly today's string. No run that never redirects changes at all.

## 3. The judge receives the step's record

- [x] 3.1 `judge()` in `src/llm/brain.ts` takes the step's record alongside the step, the expectation and the snapshot.
- [x] 3.2 `assertSystemPrompt`/`assertUserPrompt` present it as **what was done**, and state that it is not evidence the step's outcome holds — the snapshot remains the only evidence of what is now true (design D2, the main risk).
- [x] 3.3 `src/runner/executor.ts` passes the record it already holds, to **both** judge calls including the re-observation.
- [x] 3.4 Scope stays the step; cleared at every boundary, like the planner's.
- [x] 3.5 Everything in the record crosses the mask, as it already does for the planner.

## 4. Tests

- [x] 4.1 A redirecting navigation reports both URLs; a non-redirecting one is unchanged.
- [x] 4.2 The judge receives the record, masked, on both the first judgment and the re-observation.
- [x] 4.3 The record does not cross step boundaries.
- [x] 4.4 `judge-the-step` still holds. The existing substitution tests cover the unit side unchanged; the real assurance is a real-model check, since the risk is that a *model* reads the record as evidence — see 5.4.

## 5. Verification against the reproduction

- [x] 5.1 Cross-origin arm: **3 of 3 pass** (was 3 of 3 failing). And for the right reason — the judge's own words: *"The navigation to /away successfully redirected to http://localhost:4194/, and the snapshot confirms the destination page displays the expected 'Partner portal' heading."* That fact is in no snapshot; it can only have come from the record, which is the proof that D2 and not only D1 is doing the work.
- [x] 5.2 Same-origin arm still passes.
- [x] 5.3 Login journey verified against a real model: dogfood 7/7 including the auth recipe. The transcript-as-instructions failure did not recur.
- [x] 5.4 Dogfood 7/7, Score 100, 83 calls. And the sharper check: re-ran the #28 negative reproduction, where a successful `click` sits in the record while the step's outcome is absent. It **still fails**, and the demo app still holds **zero** notes. The record did not become a licence to pass, which was this change's main risk.
