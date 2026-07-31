## Context

`runCommand` runs tests in a plain `for` loop over `selected`, calling `runOne` and awaiting each one. `runOne` opens a fresh browser context, runs the test, closes the context. Nothing in it is shared with another test except the `Browser`, the `RunBudget`, the secrets mask and — when auth is configured — the captured session state, which is read-only.

So the tests are already isolated *from each other inside the browser*. The loop is the only thing serialising them.

Measured baseline, this repository's suite against the demo app: **7 tests, 156s, 85 model calls.** Wall-clock is dominated by waiting on the model and on page settling, neither of which uses local CPU.

## Goals / Non-Goals

**Goals:**
- Several tests in flight, bounded.
- A log that stays readable when they are.
- A report that does not change shape because of timing.

**Non-Goals:**
- Parallelising a journey's steps.
- Promising isolation of the application under test. We cannot give it.

## Decisions

### D1 — The default is 1, and parallelism is opted into

**Decision.** `concurrency` defaults to `1`. A run behaves exactly as it does today until someone sets it higher.

**Why not follow the usual convention.** Vitest, Jest and Playwright all default to parallel, and it would be easy to argue we should too. They can, because their tests are isolated by construction: separate processes, separate fixtures, a database per worker if you set one up. Ours are plain-English journeys driven against **one running application**, and two tests that both write to it can see each other's data. This repository's own suite contains an example — the notes test asserts *"the heading shows one note on file"*, which is only true because nothing else is adding notes at that moment.

A tool whose job is to gate merges must not, on upgrade, start producing failures that come from its own concurrency rather than from the code under review. Someone chasing that would be debugging our scheduler while believing they were debugging their application. The cost of the safe default is one line of configuration; the cost of the unsafe one is paid by whoever cannot reproduce a flake.

**Why a fixed number rather than one derived from CPU count.** A default of "half your cores" makes a run behave differently on a laptop and on a CI runner, which for a gate means the budget overshoot (D3) and the interleaving both change with the machine. Concurrency here is bounded by network waiting, not by CPU, so cores are the wrong quantity anyway.

### D2 — Buffer per test when concurrent, stream when not

**Decision.** With `concurrency > 1`, each test's events are collected and printed as one contiguous block when that test finishes. With `concurrency === 1`, events print as they happen, exactly as today.

**Why two paths rather than always buffering.** Always buffering would be simpler code and a worse tool. Watching steps arrive is how someone knows a run is progressing and where it is stuck, and taking that away from every existing user to serve an opt-in feature would be a regression paid by people who did not ask for anything. The condition is decided once, where the run's concurrency is known, not per event.

**Why not interleave with a per-line prefix.** It keeps the live feedback, but a step transcript is only legible read consecutively — the action, its result, the judgment. Interleaved at the line level, four tests produce a log where no single narrative can be followed. Blocks preserve the thing that makes the output useful.

### D3 — Overshoot is bounded by concurrency, and the spec says so

**Decision.** `RunBudget` is unchanged. The documented bound on overshoot changes from "one call" to "as many calls as can be in flight".

**Why not make the check atomic.** `check()` then `record()` is check-then-act, and with N calls in flight N can pass the check before any of them records. Reserving a call at check time would fix that for calls, but not for tokens, which are only known after the response arrives — so the honest bound would still be concurrency-dependent, and the machinery would buy a guarantee it cannot fully deliver.

**Why this is acceptable.** The bound only weakens for a run that opted into concurrency, and it weakens by a known, configured amount: set 4, and the budget can overshoot by up to 4 calls instead of 1. Someone who needs the tighter bound has it by leaving the default alone. Stating it plainly in the spec is the whole of the work; pretending otherwise would be the failure.

### D4 — Reported in selection order, never completion order

**Decision.** Results are written into a slot reserved by the test's index in the selection and read back in that order for every surface: summary, JUnit, HTML.

**Why.** A report whose row order depends on which test happened to finish first is a report that changes between runs of the same code. Diffing two reports is a real thing people do, and completion order makes it useless. This costs an indexed array.

### D5 — A budget stop lets what is running finish

**Decision.** When a `BudgetExhaustedError` stops the run, tests already in flight run to completion, no further tests start, and the rest are reported `not-run`.

**Why not cancel in flight.** Cancelling a test mid-step means closing a browser context under an action, and the result would be a test that neither passed, failed, nor was cleanly not run — a fourth state to define and report for no benefit. Letting them finish costs at most one test's duration and keeps `not-run` meaning exactly what it means today: the run stopped before this test executed.

## Risks / Trade-offs

- **Tests that interfere.** Real, and it is why the default is 1. The README must say what makes a suite safe to parallelise rather than only offering the knob: tests that write to shared server state, or assert on global counts, are the ones that cannot.
- **More load on the application under test.** Four concurrent journeys against a development instance is four times the traffic. Worth a sentence in the README; not something to solve here.
- **Two output paths to keep working.** Mitigated by deciding once, at the top, rather than per event.
- **Provider rate limits.** A user who hits one will see it as test failures. Nothing to do here beyond naming it, since the limit and its remedy belong to their account.

## Migration Plan

None. `concurrency` defaults to 1 and every existing run behaves identically, output included.

## Open Questions

None blocking. Noted: with concurrency above 1 the wall-clock deadline (`max_duration_s`) buys more work per second, so a deadline sized against serial runs becomes more generous rather than less. That is a change in what an existing setting achieves, but only for a run that opted in, and in the direction nobody complains about.
