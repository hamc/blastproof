# Tasks: measure-verdict-reliability

## 1. Mutants (design D1, D4)

- [x] 1.1 `evals/reliability/mutants.ts`: load and validate `mutants.json` (target test exists, `subtle` names an `incident`) and apply edits to a copy, each `find` exactly once. Verify with unit tests: zero and two occurrences refused, a `subtle` mutant without incident refused, a valid edit applied
- [x] 1.2 `mutants.json`: the six literal mutants from the pilot and the four subtle mutants of D4. Verify each mutant once by hand: its copy served, the targeted page shows the bug, and nothing outside the target's checked steps changed
  - *Done 2026-10-07.* The literal edits are the pilot's, all caught at the seeded step. Each subtle mutant was driven with Playwright and no model: the confirmation shows `#BP-1002` with `#BP-1001` in a second paragraph; "SAVE20 applied: 20% off" over a $120.00 total; "Check the invoice" in the Note field with 0 notes on file; "Support ticket received" while the request is in flight, then "could not be sent"

## 2. Runner and scoring (design D2, D3)

- [x] 2.1 Scoring as a pure function from a JUnit report and the mutant's declared step to one outcome; Wilson upper bound. Verify with unit tests on stored JUnit fixtures (pass, fail at declared step, fail elsewhere, incomplete) and known bound values
- [x] 2.2 `evals/reliability/run.ts` and `npm run eval:reliability`: per model, per sample, a fresh copy and server on a free port, the built CLI with `--url`, `--query`, `--junit`; models in parallel. Exit 1 when a mutant does not apply. The report prints per model and class
  - The server is stopped by PID, never by pattern
  - *Added during the live run:* a failed sign-in (exit 2, no report) scores as a false FAIL on the correct app and caught elsewhere on a mutant, read from the console log. `EVAL_RESCORE=<dir>` rescored the run without a model call (design D3)

## 3. Measurement and publication (design D5)

- [x] 3.1 Live: reference pair, 5 samples. Record the table in this file
  - *Done 2026-10-07*, `main` at 23cbac4, through OpenRouter:

    | | `claude-haiku-4.5` | `gpt-6-luna` |
    | --- | --- | --- |
    | false FAIL, correct app | 0/40 (≤ 8.8%) | 0/40 (≤ 8.8%) |
    | false PASS, literal | 0/30 (≤ 11.4%) | 0/30 (≤ 11.4%) |
    | false PASS, subtle | 2/20 (≤ 30.1%) | 0/20 (≤ 16.1%) |
    | caught elsewhere | 1 (`optimistic-ticket`, at the submit step) | 0 |

    Both false PASSes are `order-number-elsewhere`, in samples 1 and 5. Filed as #147
- [x] 3.2 Live: `openai/gpt-4o-mini`, 5 samples. Record the table here, not in the README
  - *One sample, not five.* It ran about four times slower than the pair, and the first sample settled the question it was there for. Its sign-in failed in 5 of the 10 runs that reached it, including the unmodified suite. The model pressed Enter while filling a field and then could not verify the fill, which makes 8/8 false FAILs on the correct app. It took `order-number-elsewhere` as a false PASS too (#147). The literal mutants it did not lose to sign-in were caught at an earlier step. This is evidence for the default-model proposal, not a published number
- [x] 3.3 README: a "How often a verdict is wrong" section with the table, command, version, date, samples, and the caveat that the demo app is small
- [x] 3.4 `CONTRIBUTING.md`: run the benchmark before a release and before a change claiming better reliability. `AGENTS.md`: a convention on mutants (D1, D4) and the coverage rule

## 4. Verification

- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [ ] 4.2 Archive in the same pull request, as its own commit
