# Tasks: judge-a-done-that-closes-a-check

- [x] 1.1 `authoring.ts`: one constant for the check verbs; `hasVerificationClause(step)` (design D2)
- [x] 1.2 `executor.ts`: on a step with a verification clause, the `done` becomes an `assert` and falls through to its branch (design D1, D3)
- [x] 1.3 Unit tests from the design's measurement plan; mutation-check that removing the `done` branch's judgment fails them
  - *Done.* With the judgment skipped, 4 executor tests fail; with the comma dropped from the clause, the authoring test for `navigate to /notes, check the heading` fails
- [x] 1.4 `npm run build`, `npm run typecheck`, `npm test` pass. `eval:judge` does not apply: `judge()` and its inputs' shape are unchanged, and the corpus replays `judge()` alone
- [x] 1.5 Live: the notes test on `gpt-6-luna`, 5 runs
  - *Done.* 5 of 5 passed. 3 closed on a judged `done`, 2 on an `assert`; none unjudged (5 of 5 before)
- [x] 1.6 Live: `npm run eval:reliability` on the reference pair; compare with the 0.26.0 run
  - *Done.* False FAIL 0/40 on both; false PASS 0/30 literal on both, 0/20 subtle on Luna and 0/19 on Haiku (one sample stopped on the provider's credit, reported incomplete). Calls: Luna 1407 (1396 before), Haiku 1671 (1708 before). Every clause step closed on `done` was judged
- [x] 1.7 Live: the budgeting app's suite
  - *Done.* 21 of 21, 331 calls (332 before). 5 clause steps closed on a judged `done`, all passing; none unjudged (4 before)
- [x] 1.8 Skill authoring table / AGENTS.md: the verification-step paragraphs mention the clause; CHANGELOG entry. The README has no such paragraph
- [x] 1.9 Archive in the same pull request, as its own commit
