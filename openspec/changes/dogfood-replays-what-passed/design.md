# Design: dogfood-replays-what-passed

## D1. Two runs with replay on, not one off and one on

A run with replay on and nothing saved asks the model for every step. That is the same decision path as a run with replay off, and it also saves what passed. So two runs give the off case and the on case for the price of one cold run and one warm one. A third run with replay off would repeat the cold run.

Rejected: an off run and then an on run. The on run would start with nothing saved, so it would be a second cold run, and replay would still never run.

## D2. The demo app restarts between the runs

`serve.mjs` keeps the notes in memory, and `notes.yaml` checks that the heading shows one note on file. On the same server, the warm run would find two notes and fail a correct application. The start step writes the server's PID to a file, and the restart kills that PID only, never a pattern match.

## D3. The warm run fails below half its steps replayed

Without a floor, a replay that stopped working would pass: the model resolves every step and the score stays 100.

The floor is `replayed_steps / (replayed_steps + model_steps) >= 0.5`, read from the warm run's JUnit properties. It is loose on purpose:

- Measured warm runs replayed 39 steps in 40 on `gpt-6-luna`.
- One step always goes to the model: "Add to cart" has a same-named twin on the page, and a saved element with two matches is never replayed.
- Each replay that ends hands one step to the model, and a step that ended is not replayed again.

A floor near the measured rate would turn ordinary model variance on the cold run into a red badge. Half is far from both the measured rate and from zero, which is what a broken replay gives.

Missing properties count as zero replayed: they mean the run did not report replay at all, which is the failure this check exists for.

Rejected: a floor on a fixed count of steps. It would break every time a test is added or removed.

## D4. Both runs gate on the score

The warm run is the first place replay runs on a clean Linux runner with a fresh Chromium. A false FAIL there is a finding about replay. It is not noise to ignore.

Cost: the job now has two chances a week to hit a flaky model answer. The workflow stays off the merge path, so a red badge blocks nobody. It shows a problem to look at.

## D5. No cache between workflow runs

A cache kept between weeks would make most weekly runs warm. The cold run is the only one that shows the model and the provider still work, so it must run every week.
