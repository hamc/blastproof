## 1. Confirm the numbers are there and discarded

- [x] 1.1 Run the dogfood suite and confirm the tool reports no spend today, while `--dry-run` reports a worst case many times larger. Record both numbers.
- [x] 1.2 Confirm what the provider actually reports for `totalTokens` on a real run, so D1's three cases are grounded rather than assumed.

### Findings

- The tool reports no spend today. `--dry-run` for the dogfood suite reports a worst case of **735 model calls**.
- A single test plus the login journey spends **13 calls**, against a `--dry-run` ceiling of **105** for the same selection. The only figure the tool volunteers is 8× the real one.
- OpenRouter returns full usage, `totalTokens` included, on every call. So D1's "every call reported" is the normal case and the other two are the defensive ones — which is the right way round, since the honest failure is silent.

## 2. `RunBudget` can describe itself

- [x] 2.1 Count how many calls reported usage at all, alongside calls and tokens.
- [x] 2.2 A single method returns the spend — calls, tokens, how many calls the token figure covers, and the configured limits — so every surface takes the same numbers from the same object and cannot disagree (design D1).
- [x] 2.3 Formatting lives with the other summary lines in `src/report/score.ts`, not in the console command, so JUnit and HTML are not tempted to recompute it.

## 3. The owner reports

- [x] 3.1 `run` and `plan` report only when they constructed their own budget; when a caller handed one in, that caller reports (design D2).
- [x] 3.2 `test` reports once, after both phases, for the one allowance it created.
- [x] 3.3 Do not implement this as "print at the end of `runCommand`" with a flag threaded in to suppress it. Ownership is the rule; a suppression flag is the same rule written where it can be forgotten.

## 4. Every surface

- [x] 4.1 The console summary, for a completed run and for one stopped by its budget or deadline (design D3).
- [x] 4.2 JUnit properties beside `score`.
- [x] 4.3 The HTML report's summary block.

## 5. Tests

- [x] 5.1 A run reports the calls and tokens it spent.
- [x] 5.2 A provider that reports no usage produces "unavailable", never `0 tokens`.
- [x] 5.3 A run where only some calls reported usage says what the figure covers.
- [x] 5.4 With limits configured, the spend is reported against them.
- [x] 5.5 A run stopped by its budget still reports what it spent.
- [x] 5.6 A composed `test` run reports the spend once, not once per phase.
- [x] 5.7 JUnit carries the properties; the existing `score` property is unchanged.

## 6. Verification

- [x] 6.1 Real dogfood run: `Spent: 82 model call(s), 115407 token(s)` for 7 passing tests; JUnit carried `llm_calls=82` and `llm_tokens=115407` beside `score=100`. The `--dry-run` ceiling is unchanged at 735.
- [x] 6.2 With `--max-llm-calls 8`: `Spent: 8 of 8 model call(s), 12105 token(s)` printed above `Run incomplete: model call budget exhausted`. Both facts, in that order.
- [x] 6.3 **735 ceiling against 82 actual, a ratio of 9:1.** Anyone sizing `max_llm_calls` from the only number the tool used to offer would set it about nine times too high. That ratio is the whole argument for this change, and it is now measured rather than asserted.
