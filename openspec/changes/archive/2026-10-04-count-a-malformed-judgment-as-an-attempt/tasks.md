# Tasks: count-a-malformed-judgment-as-an-attempt

## 1. The executor (design D1)

- [x] 1.1 Both `judge` calls in the `assert` branch are wrapped together. A non-`RunStoppedError` becomes the `assert`'s result `error: <message>`, is emitted, costs one attempt, and fails the step only when the budget is spent. Verify with executor tests: a judge that throws once and then passes closes the step as passed, with the error in the record; one that always throws fails the step after `maxRetries` attempts; a re-observation that throws costs one attempt, not two; a `RunStoppedError` from either call propagates
- [x] 1.2 Every existing executor test passes

## 2. The login (design D2)

- [x] 2.1 `verify` is retried on a malformed answer, up to `maxRetries`, with a fresh snapshot each time; a `RunStoppedError` propagates; exhaustion throws `AuthError` naming the last error. Verify with auth tests for the three cases
  - *The last error is masked before it reaches the `AuthError`, as the judge's reason is*

## 3. The message (design D3)

- [x] 3.1 `ProviderRefusedError` puts a period between a detail not ending in `.`, `!` or `?` and the remedy. Verify with a budget test using `connect ECONNREFUSED 127.0.0.1:5995`

## 4. Verification

- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` all pass
- [x] 4.2 Mutation check: restore the bare `judge` call; drop the `verify` retry; count two attempts for a failed re-observation. Each must turn a test red
  - *Done.* Restoring the bare call turns three executor tests red. Dropping the retry turns the auth test red. Counting two attempts for a re-observation error turns its test red
- [x] 4.3 Live, the three corruptions in the design's table, each run twice: the test or the login no longer fails on the malformed answer
  - *Done 2026-10-05, each corruption twice on `examples/demo-app`.* Body not JSON on the first judgment (`--tag consent`): PASS 2/2, the log showing `assert :: error: Invalid JSON response` and then a passing assertion. Completion that is not the schema: PASS 2/2. Body not JSON during the login journey (`--tag smoke`, landing on step 1 in one run and on step 4 in the other): login completed and 3/3 tests PASS, 2/2. Before the change, the same corruptions gave FAIL, FAIL and `Authentication failed`, exit 2. The `verify` retry is covered by the auth unit tests: the corruption never landed on the `verify` call live
- [x] 4.4 Live, the dogfood suite: no regression
  - *Done.* 8 of 8, Score 100, 91 model calls, against a freshly started demo app. A first run against a demo server left running since earlier suites failed the notes test: the page already listed earlier `Check the invoice` notes and its count was 2, so the step could not tell its own note apart, and the final "one note on file" could not hold. No judge error was involved (0 in three runs). This is the server's accumulated state, not a defect
- [x] 4.5 Archive in the same pull request, as its own commit
