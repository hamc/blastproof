# Tasks: judge-the-place-the-step-names

## 1. The judge (design D1, D2, D3)

- [x] 1.1 `assertSystemPrompt`: the place-of-outcome paragraph after the paragraph on claims, with a comment naming #147
- [x] 1.2 `assertJudgmentSchema.pass`: the place sentence, without D3's removed sentence

## 2. Corpus (design D5)

- [x] 2.1 `evals/judge/cases/issue-147.json`: two captured relocating claims, one captured neutral claim, one reconstructed control
- [x] 2.2 Replay on the reference pair before the fix: the captured relocating claim is wrong on Haiku 0/3, right on Luna 3/3, everything else as before
- [x] 2.3 Replay after the fix: every #147 case right on both models, no regression
  - `121-already-dismissed-run1-2`, marked `knownFailing #129`, was right on both models in this replay and again in the D2-only ablation, and wrong before D2. Its marker is removed. The other two #129 cases are still wrong on Haiku

## 3. Live (reliability benchmark)

- [x] 3.1 Mutant `order-number-elsewhere`, 10 samples on Haiku, with D1 alone, with D1 and D3's sentence, and with the final D1 and D2
- [x] 3.2 Ablation: corpus with D2 alone
  - *Done.* `147-claim-relocates-the-value-run1` stays wrong on Haiku, 0/3. D1 is needed for the case, D2 for the live sample D1 missed
- [x] 3.3 Full benchmark on the reference pair. Update the README table if it moved
  - *Done 2026-10-07.* Haiku: false FAIL 0/40, false PASS 0/30 literal and **0/20 subtle** (was 2/20). Luna: 0/40, 0/30, 0/20, unchanged. `optimistic-ticket` was caught at "submit the support form" instead of the declared step in 3 of Haiku's 5 samples, against 1 before. That is a right verdict one step earlier, because the page says the ticket could not be sent

## 4. Verification

- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 4.2 `AGENTS.md`: the judge-corpus convention lists #147 among the incidents
- [x] 4.3 Archive in the same pull request, as its own commit
