# Proposal: dogfood-replays-what-passed

## Why

`replay` (#144) shipped off by default and was measured on a developer machine under WSL. The weekly Dogfood workflow, the public evidence that the agent works, runs with it off, so nothing exercises replay on a clean runner, and nothing would notice a later change that silently stops it from working.

A broken replay is invisible to the score. When a saved step cannot be replayed, the model resolves it, so the test still passes and the run still scores 100. Only the count of replayed steps shows the difference.

## What Changes

The Dogfood job runs the suite twice, with `--replay` both times, on a fresh checkout:

1. **Cold run.** Nothing is saved yet, so every step is decided by the model: the behaviour most users have, since replay is off by default. It is gated on the score as today, and saves what passed.
2. **Warm run.** The demo app is restarted first, since it keeps notes in memory and the notes test checks a count. The suite runs again on what the cold run saved. It is gated on the score too, and on the share of its steps that were replayed: at least half of the steps the replay counters cover. Below that, the job fails and names the numbers.

The replay line of both runs goes to the job summary, and both JUnit reports are uploaded.

The cache is never kept from one week to the next. The demo app hardly changes, so a kept cache would replay almost every step every week, and the run that proves the model still works would stop asking it.

## Capabilities

### New Capabilities

- `dogfood`: what the scheduled self-test runs and what fails it.

### Modified Capabilities

_None._

## Non-goals

- Measuring whether replay changes how often a verdict is wrong. That needs many samples and seeded bugs, and `npm run eval:reliability` with `EVAL_REPLAY=1` already does it. The Dogfood job is one sample and a gate.
- Caching replay files between workflow runs.
- Running the Dogfood job on pull requests. It stays scheduled, for the reason its header gives.
- Any change to the product.

## Impact

- `.github/workflows/dogfood.yml`: the two runs, the restart, the replay floor, the summary and the uploads.
- `docs/reliability.md`: one paragraph on what the badge now covers.
- Cost: the warm run measured about 49 model calls against 113 for a cold one on Haiku 4.5, so a week's run costs about 40% more.
