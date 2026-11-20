# Tasks: dogfood-replays-what-passed

- [x] 1.1 `dogfood.yml`: the demo app's PID kept at start; both runs with `--replay`; a restart by that PID between them (design D1, D2)
- [x] 1.2 `dogfood.yml`: the replay floor on the warm run's JUnit, with both counts named on failure; both runs' counts in the job summary (design D3)
- [x] 1.3 `dogfood.yml`: both JUnit reports uploaded; no cache step (design D5)
- [x] 1.4 Review round: the dispatch input says it caps each run; the replay checks also run after a failed run that left a report; the saved replay files uploaded on failure; the restart kills a server that outlived the wait, refuses a port something else answers on, and fails when the new server exits; a missing report is named (design D6)
- [x] 2.1 Run the workflow's shell steps locally against the demo app, cold and then warm, and check the floor fails on a JUnit with no replayed step
  - *Done,* on Haiku 4.5 through OpenRouter with the workflow's environment: cold run 0 replayed, 40 by the model, Score 100; demo app restarted by its PID; warm run 39 replayed, 1 by the model (1 healed), Score 100, the notes test passing on the restarted server. The check on crafted reports: warm 39/1, 20/20 pass; warm 19/21, 0/40 and no counters fail; cold 0/40 passes; cold 3/37 fails
- [x] 2.2 `docs/reliability.md`: what the badge covers now
- [x] 2.3 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 2.4 Archive in the same pull request, as its own commit
