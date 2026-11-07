# How often a verdict is wrong

Back to the [README](../README.md).

## blastproof tests itself

The **Dogfood** badge is blastproof running against the demo app in this repo — real Chromium, real model, scored and gated, with public logs. It catches real regressions rather than diffing strings: change the demo discount from 20% to 5% while the page still claims *"20% off"* and it fails the step — that is the run in the GIF at the top of this page, verbatim.

No selector was updated to catch that. The agent read the value, did the arithmetic, and disagreed with the page.

Try it yourself:

```bash
git clone https://github.com/hamc/blastproof && cd blastproof
npm install && npm run build
node examples/demo-app/serve.mjs 4173 &
export ANTHROPIC_API_KEY=...
node dist/cli.js run
```

## Measuring wrong verdicts

A merge gate is judged by two numbers. A **false PASS** is a test that passes on an app with the bug it exists to catch. A **false FAIL** is a test that fails on a correct app. `npm run eval:reliability` measures both. It runs the suite above on the demo app as it is, and each test on **mutants**: copies of the app with one bug seeded. A *literal* mutant changes the value a step quotes. A *subtle* one reproduces the shape of a wrong verdict this project has already had, such as the right value in the wrong place, or a success message with no success behind it.

| | `claude-haiku-4.5` | `gpt-6-luna` |
| --- | --- | --- |
| false FAIL, correct app (40 test runs) | 0 (≤ 8.8%) | 0 (≤ 8.8%) |
| false PASS, literal bugs (30) | 0 (≤ 11.4%) | 0 (≤ 11.4%) |
| false PASS, subtle bugs (20) | 0 of 19 (≤ 16.8%) | 0 (≤ 16.1%) |

The bounds are 95% upper bounds: zero errors in 40 runs means "below about 9%", not "never". The first run of this table found a false PASS on Haiku, 2 subtle runs in 20. The confirmation showed order `#BP-1002`, another paragraph mentioned `#BP-1001` as a previous order, and a step checking for `#BP-1001` *in the confirmation* passed. That was fixed in the judge ([#147](https://github.com/hamc/blastproof/issues/147)). On 0.26.0, Haiku had one false FAIL in 40, in the notes test: the note was listed and counted, but the model had typed it into the empty field again, and the judge read the filled field as a form not yet submitted. One subtle run on Haiku ended incomplete, and is left out of its count.

The demo app is small and well labelled, so these numbers flatter. Expect a real application to do worse. The point of this table is that it can be reproduced, and that every change claiming better verdicts has to move it.

The same benchmark over seven more models, and why it chose the OpenAI and Ollama defaults, is in [Choosing a model](./configuration.md#choosing-a-model).

Measured 2026-10-13 on 0.27.0, 5 samples, through OpenRouter. To reproduce:

```bash
npm run build
EVAL_MODELS=anthropic/claude-haiku-4.5,openai/gpt-6-luna npm run eval:reliability
```
