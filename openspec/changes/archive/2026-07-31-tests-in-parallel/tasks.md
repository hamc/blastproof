## 1. Measure the baseline first

- [x] 1.1 Time the dogfood suite serially and record wall-clock, calls and tokens, so the change is judged against a number rather than an impression.
  - **7 tests, 156s (2m36), 85 model calls, 118676 tokens.**

## 2. A bounded pool

- [x] 2.1 A small `mapWithConcurrency`-style helper, in its own module and unit-tested independently of the browser: bounded in flight, results in input order, one rejection does not lose the others' results.
- [x] 2.2 `runCommand`'s `for` loop becomes a call to it. `runOne` is untouched — it already opens and closes its own context.
- [x] 2.3 Results are placed by the test's index in the selection, so every surface reports in selection order regardless of finishing order (design D4).
- [x] 2.4 A budget stop lets in-flight tests finish, starts no more, and reports the rest `not-run` (design D5). `budget.check()` still runs before each test starts, not only inside the brain.

## 3. Output that survives concurrency

- [x] 3.1 `printEvent` becomes a per-test sink. With concurrency 1 it writes through immediately, exactly as today; above 1 it collects and the block is printed when the test finishes (design D2).
- [x] 3.2 Decide which mode once, where the run's concurrency is known — not per event, and not by checking a global inside the printer.
- [x] 3.3 The test's header line (`> summary [P0] (path)`) belongs to its block, not printed on start, or blocks will be separated from their headers.

## 4. Configuration

- [x] 4.1 `concurrency:` in the config schema, integer, minimum 1, **default 1** (design D1).
- [x] 4.2 `--concurrency <n>` on `run`, overriding the file, matching how the budget flags already work.
- [x] 4.3 Reject a value below 1 with the house error style rather than silently clamping.

## 5. Tests

- [x] 5.1 The pool runs no more than N at once, and returns results in input order.
- [x] 5.2 A run with concurrency 1 produces byte-identical console output to today's.
- [x] 5.3 With concurrency above 1, each test's events appear contiguously, not interleaved.
- [x] 5.4 The summary, JUnit and HTML report in selection order even when completion order differs.
- [x] 5.5 A budget stop with several tests in flight: those finish, the rest are `not-run`.
- [x] 5.6 `--concurrency` beats the config file; an invalid value is rejected.

## 6. Verification

- [x] 6.1 Re-run the dogfood suite at concurrency 4 against a real model. Compare wall-clock with the 156s baseline and state the speedup honestly, including whether the token and call counts moved.

  | | wall-clock | calls | tokens | result |
  |---|---|---|---|---|
  | serial | 156s | 85 | 118676 | 7/7 |
  | concurrency 4 | **68s** | 81 | 114349 | 7/7 |

  **2.3× faster.** Calls and tokens are unchanged within run-to-run noise, which is the expected result: parallelism buys wall-clock, not spend. The speedup is short of 4× because the login journey runs once before any test starts and is not parallelised, and because the pool drains at the end while the longest test finishes alone.
- [x] 6.2 Confirmed: at the default the transcript still arrives step by step as it happens, byte-identical in shape to before.

  **A first concurrent run failed, and it was worth chasing rather than re-running.** The notes test failed on the contained-recovery refusal. It was not interference between tests: the demo server had been up across several runs, each adding one note, so `Notes on file` was 2 where the test asserts 1. Restarted clean, 7/7. The finding is real but it is about *our own suite not being idempotent against a persistent application* — the same hazard as two tests interfering, separated in time rather than running at once. It belongs in the README as the concrete example, which is task 6.3.
- [x] 6.3 README says what makes a suite unsafe to parallelise, using this repository's own notes test as the example — it both writes shared server state and asserts on a global count, which is exactly the combination that cannot be run beside itself.
