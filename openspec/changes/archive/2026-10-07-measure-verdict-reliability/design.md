# Design: measure-verdict-reliability

## Context

The pilot (proposal) ran `dist/cli.js run --url <copy> --query <test>` against a copy of `examples/demo-app` with one `sed` edit. All 24 runs failed at the seeded step, at about 40k tokens (Haiku) and 27k (Luna) per run. This design turns that script into a repeatable measurement without making the number easy to flatter.

## D1. A mutant is an exact text edit to a temporary copy

`evals/reliability/mutants.json` declares each mutant: `id`, `class` (`literal` | `subtle`), `incident` (required for `subtle`), `test` (the YAML file it targets), `step` (the step text expected to fail), and `edits`, a list of `{ file, find, replace }`. The runner copies the demo app to a temporary directory and applies each edit, and **each `find` must occur exactly once** in its file, or the run fails before a model is called.

Rejected:
- **Bug switches inside the demo app** (`?bug=…`, an env flag). The demo app is the README's quick start, and it would ship bug code paths to every reader.
- **Committed copies of the app per mutant.** They drift from the app silently. An exact-once `find` breaks loudly when the app changes under it.

## D2. The real CLI, one fresh server per run

Each sample starts `serve.mjs` from its own copy on a free port, then runs the built CLI with `--url` and `--query <summary>` and `--junit`, then stops the server. The notes test writes server state, so a fresh server per run is what makes samples independent. It also lets models run in parallel without sharing state. The verdict and failing step are read from the JUnit report, never from the console text, which is for people.

Rejected: **calling the executor in-process.** The number has to describe what a user runs, including auth, settling and the budget path.

## D3. Scoring

Per mutant sample, exactly one of:

- **caught**: the target test FAILs at the declared step;
- **caught elsewhere**: it FAILs at another step. Reported apart, since a failure for the wrong reason would have passed had that step held;
- **false PASS**: it PASSes;
- **incomplete**: the run stopped (budget, provider), and the sample is excluded and counted.

The unmodified suite runs the same number of samples per model: each test is a **PASS** or a **false FAIL**.

A run whose sign-in failed exits 2 with no report, so no test reached a verdict. It is still not incomplete. The gate failed, and that is the verdict a user receives. On the unmodified app, every test of that run is a false FAIL. On a mutant, it is caught elsewhere. The first full run found this: `gpt-4o-mini` pressed Enter while filling the password, and the first version of the scorer counted the result as incomplete, which hid a real false FAIL. That is why the runner reads the sign-in failure from the console log, the one fact the JUnit report does not carry. `EVAL_RESCORE=<dir>` scores a finished run's logs again without calling a model, so a scoring fix does not cost a rerun.

Rates are given with sample counts and a 95% Wilson upper bound, because with 0 false PASS in 60 samples the honest claim is "below about 6%", not "0%". "Caught elsewhere" is not counted as a false PASS, but it is shown on the same line, so a reader can do so.

## D4. Subtle mutants come from incidents

A literal mutant changes the value a step quotes. The pilot shows a model catches those every time. Subtle mutants reproduce the shape of a wrong verdict this project has already had. The first set:

| id | target | shape | incident |
| --- | --- | --- | --- |
| `order-number-elsewhere` | checkout | the confirmation shows `#BP-1002` while `#BP-1001` appears elsewhere on the page | #87, #120: the right token, the wrong place |
| `promo-message-only` | cart-discount | "SAVE20 applied" is shown, the discount is not | judge-the-step: a true claim beside the step |
| `note-in-textbox` | notes | the note is not saved and comes back in the field, not the list | judge-the-step: an uncommitted value |
| `ticket-reverts` | support | the confirmation renders, then the page returns to the form | #25: a verdict on a page that had not settled |

A mutant may break **only what its target's steps check**. A bug the steps cannot see would measure the test's coverage, which is the author's job, not the verdict's.

Each new verdict incident adds a subtle mutant when its shape can be reproduced in the demo app, as it adds a judge-corpus case today.

## D5. Models, samples, publication

Default samples: 5 (`EVAL_SAMPLES`). Models come from `EVAL_MODELS`, as in `eval:judge`. The published configuration is the reference pair. `openai/gpt-4o-mini` is measured once before the first publication, because it is the OpenAI default and has never been measured on anything. Its number feeds the separate default-model proposal.

The README gets a short section with the table per model and class, the command, the blastproof version, the date and the samples. It is updated when a release changes a verdict path, with the same discipline as the CHANGELOG.

## Risks

- **A small app flatters.** The demo app is easy compared with Juice Shop. The published section says so and names the app. Reproducibility is worth more than a harder app nobody can rerun.
- **Mutants tuned to pass.** A mutant is written before it is run, and a mutant that is caught every time stays, since removing it would bias the rate.
