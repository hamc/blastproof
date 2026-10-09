# Design: pick-the-defaults-by-measurement

## D1. False FAIL decides first, then false PASS

A default is what a user meets before they know anything about models, usually in CI. The benchmark separates two failures:

- A false PASS lets a bug through. It is the worse failure for a single run.
- A false FAIL on a correct app happens on every run, so a gate that fails often is turned off.

Once the gate is off, it catches nothing. Every model tested had a false PASS rate whose upper bound is between 11% and 17%. On false FAIL, the models split by an order of magnitude. That is the measurement able to tell them apart.

Rejected: **`qwen3.6-35b-a3b` for Ollama.** It caught the most bugs at the right step (43/50) and never failed sign-in. It still failed 11 of 40 tests on the correct app, so a suite of 8 tests is red on most runs. It is also larger.

## D2. `gpt-oss-20b`'s false PASS is published, not hidden

`gpt-oss-20b` accepted `#BP-1002` as the `#BP-1001` the step asked for, once in 30 literal trials (`order-number`). One error against zero in 50 trials does not separate it from the others statistically: the bounds overlap. The table shows it, and the docs say what it was. If a later run repeats it, it becomes a judge-corpus case like #147, not a reason to keep a default that fails 40 of 40 tests.

## D3. The measurement was through a gateway; the default is local

The open models were measured on OpenRouter, routed with `extra_body` as `docs/configuration.md` recommends. Ollama's `gpt-oss:20b` is the same weights in the same MXFP4 format the model was released in, so the measurement transfers better than it would for a re-quantised model. It is still not the same runtime, and the docs say so. Local verification needs a machine with about 16 GB for the model. If one is available, it runs before merge.

## D4. Each default names its evidence

`DEFAULT_MODELS` gets a comment pointing to the table in the docs and to this change. The `llm-providers` requirement is restated: the default is the documented one, *and* the documentation shows the measurement it was chosen on. Changing it again means running the benchmark again.
