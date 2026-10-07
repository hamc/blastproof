# Proposal: measure-verdict-reliability

## Why

Nobody knows how often blastproof's verdicts are wrong (#143). The judge corpus checks single judgments; the dogfood suite runs only against a correct app. Neither measures:

- **false PASS**: a test passes on an app with the bug it exists to catch;
- **false FAIL**: a test fails on a correct app.

Every wrong verdict so far (#87, #112, #120, #121, #139, #141) was found by chance or an adversarial pass.

A pilot seeded six bugs into the demo app and ran each targeted test twice per reference model:

| model | caught | caught at the seeded step | tokens per run |
| --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 12/12 | 12/12 | ~40k |
| `openai/gpt-6-luna` | 12/12 | 12/12 | ~27k |

The method works; the pilot shows its trap: all six bugs changed exactly the value a step quotes. Built only from such bugs, the benchmark would publish "0% false PASS" and mean nothing. The incidents were subtler: the right value elsewhere on the page, a true claim beside the point, an outcome produced by the check itself.

## What Changes

- `npm run eval:reliability` SHALL run the dogfood suite against the demo app unmodified, and each targeted test against its **mutants**: declared, exact text edits to a copy of the app.
- Each mutant SHALL name its target test, the step expected to fail, and its **class**: **literal** (the quoted value changes) or **subtle** (the shape of a named past incident). An edit that does not apply exactly once SHALL fail the run.
- A mutant SHALL break only what its target's steps check: this measures verdicts, not coverage.
- The report SHALL give, per model and per class:
  - the false PASS rate on mutants, with a 95% upper bound;
  - the false FAIL rate on the unmodified suite;
  - catches at an unexpected step, counted apart as luck.
- Incomplete runs SHALL be reported and excluded, never counted as a verdict.
- The **reference pair** (Haiku, Luna) SHALL be the published configuration. `gpt-4o-mini`, still the OpenAI default, SHALL be measured once before the first publication.
- The first full result SHALL be published in the README with command, version, models and samples.

## Capabilities

### New Capabilities

- `reliability-benchmark`: what the benchmark runs, how a verdict is scored, what it reports

### Modified Capabilities

_None._

## Impact

- New dependencies: **none**
- New `evals/reliability/` and a `package.json` script; README, `CONTRIBUTING.md`, `AGENTS.md` updated
- No product code changes. Needs a key, stays out of CI, like `eval:judge`
- A full run, 5 samples: about US$6 on Haiku, under US$1 on Luna (pilot estimate)

## Non-goals

- **Apps other than the demo app.** A public number must be reproducible with one command
- **Changing the OpenAI default.** The `gpt-4o-mini` number is evidence for its own proposal
- **Gating CI on it.** It runs before a release and before a change claiming better reliability
