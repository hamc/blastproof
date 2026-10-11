# Tasks: repeat-a-click-that-moves-the-page

- [x] 1.1 `StepRecovery`: keep the last observed page; `record` stores it with the commit and marks it as the last success; `repeatedCommitRefusal` allows a repeat that follows itself on a page that moved (design D1, D2)
- [x] 1.2 Unit tests: tour shape allowed; #124 shape (fill between) refused; #28 shape (other click between) refused; page unmoved refused; re-render with new refs only refused; a judgment between does not break the exception
  - *Done.* Mutation-checked: dropping the follows-itself check fails the #124, #28 and earlier-commit tests; dropping the page check fails the unmoved-page tests and three existing executor tests; dropping the exception fails the tour, Enter and re-observation tests
- [x] 1.3 Live: dogfood notes test, 5 runs on Haiku 4.5, no duplicate note; the real app's tour as one "until" step
  - *Done.* Notes, 5 runs: each run clicked "Add note", refilled the field and proposed "Add note" again; refused 5 of 5, one note on file, 5 passes. Tour (`click "Next" … until it shows its last step`), Haiku 5.5, 3 runs: 7 clicks on "Next", no refusal, 3 passes
- [x] 1.4 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 1.5 Archive in the same pull request, as its own commit
