# Configuration

Everything blastproof reads from `.blastproof/config.yaml`, and every environment
variable that overrides it.

`blastproof init` scaffolds this file with comments. Nothing here is required
except `base_url` — each section below says what happens when you leave it out.

- [Precedence](#precedence)
- [`base_url`](#base_url)
- [`llm` — provider, model, key](#llm--provider-model-key)
- [`browser` — waiting and snapshots](#browser--waiting-and-snapshots)
- [`concurrency` — running tests at once](#concurrency--running-tests-at-once)
- [`budget` — bounding what a run spends](#budget--bounding-what-a-run-spends)
- [`max_retries_per_step`](#max_retries_per_step)
- [`routes` and `ignore`](#routes-and-ignore)
- [`allowed_origins`](#allowed_origins)
- [`auth`](#auth)

## Precedence

**CLI flag > environment variable > config file.**

The rule is the same everywhere, so a CI job can override one setting without a
file edit, and a single invocation can override the CI job.

| variable | overrides |
| --- | --- |
| `BLASTPROOF_BASE_URL` | `base_url` — the app under test |
| `BLASTPROOF_LLM_PROVIDER` | `anthropic` \| `openai` \| `ollama` |
| `BLASTPROOF_LLM_MODEL` | the model name |
| `BLASTPROOF_LLM_BASE_URL` | the provider endpoint — *not* the app |
| `BLASTPROOF_LLM_API_KEY_ENV` | the **name** of the variable holding your key |
| `BLASTPROOF_MAX_LLM_CALLS` | `budget.max_llm_calls` |
| `BLASTPROOF_MAX_TOKENS` | `budget.max_tokens` |
| `BLASTPROOF_MAX_DURATION_S` | `budget.max_duration_s` |

## `base_url`

The root of the application under test. Every relative `navigate` path resolves
against it, every test starts there, and its origin is the security boundary the
agent may not leave.

```yaml
base_url: http://localhost:4173
```

`--url` overrides it for one invocation, which is how you point a run at a pull
request preview deployment without touching the file.

## `llm` — provider, model, key

Three providers are supported directly. You bring the key; nothing is proxied
through anyone.

```yaml
llm:
  provider: anthropic          # anthropic | openai | ollama
  model: claude-haiku-4-5      # optional — each provider has a default
  api_key_env: ANTHROPIC_API_KEY
```

| provider | key variable | default model | notes |
| --- | --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-haiku-4-5` | |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` | |
| `ollama` | none | `qwen2.5` | local, set `base_url` to your endpoint |

**`api_key_env` names the variable, it does not hold the key.** This is
deliberate: the key never appears in a file that could be committed, and error
messages can keep naming the variable *you* chose rather than a generic one.

### OpenAI-compatible gateways

`provider: openai` plus a `base_url` reaches anything speaking the OpenAI API —
OpenRouter, Together, a self-hosted gateway, vLLM. No file edit needed:

```bash
export BLASTPROOF_LLM_PROVIDER=openai
export BLASTPROOF_LLM_MODEL=anthropic/claude-haiku-4.5
export BLASTPROOF_LLM_BASE_URL=https://openrouter.ai/api/v1
export BLASTPROOF_LLM_API_KEY_ENV=OPENROUTER_API_KEY
blastproof run --impacted --min-score 80
```

### Ollama, for a run that never leaves the machine

```yaml
llm:
  provider: ollama
  model: qwen2.5
  base_url: http://localhost:11434/v1
```

No key, no network beyond your own host. Smaller local models are more likely to
return malformed actions, which a step spends from its retry budget — expect more
retries than a hosted model, and prefer tests whose steps state their outcomes
plainly.

### Temperature is not configurable, on purpose

There is no `temperature` key. The call that judges a step is pinned to 0 in the source; the calls that choose an action and draft a test are left at the provider's default.

They want opposite things. Judging is a decision, and two decisions about one page must agree — it is the number `--min-score` gates a merge on. Choosing an action is a search, and sampling is how the agent finds a route through a page the test's author never saw.

A key here would be set once, forgotten, and surface months later as a gate that flips, with nobody connecting the two. If a real workload needs it, that is evidence worth reopening on.

**Pinning narrows variance; it does not make a run reproducible.** Provider batching, floating point, and gateway routing between providers or quantizations all remain — and a gateway is exactly where the reported flip was measured.

## `browser` — waiting and snapshots

```yaml
browser:
  headless: true
  timeout_ms: 30000
  max_snapshot_lines: 200
```

### `timeout_ms`

Bounds **every** wait: resolving a target element from the accessibility tree,
and navigation — not only the click or fill performed afterwards. That is one
knob rather than two on purpose; the earlier behaviour, where it bounded only
the action, meant a slow-hydrating page failed while the configured limit was
never reached.

Raise it for an application that is merely slow to start rendering. The
trade-off is direct: a genuinely missing element then takes correspondingly
longer to fail.

It never changes how many self-healing retries a step gets. **Waiting and
retrying are deliberately separate** — one is about a slow application, the other
about a wrong guess, and a single knob for both would make each unfixable
without breaking the other.

Note that this is not the same as the internal 2-second settle wait taken before
every page snapshot. That one is fixed and short by design: `networkidle` is the
load state most likely never to arrive at all on a page holding a websocket or a
poll, and tying it to a 30-second limit would let one such page cost 30 seconds
on *every* step.

### `max_snapshot_lines`

Caps how much of the accessibility tree is sent to the model per snapshot.
Dense pages are truncated at 200 lines by default.

**Truncation is always marked in the snapshot**, so the model is never misled
into believing it saw the whole page. Raise this if your pages are genuinely
large; the cost is tokens on every call of every step, which is the single
largest lever on what a run spends.

### `headless`

`false` opens a visible browser, which is the fastest way to understand why a
step is failing. Not useful in CI.

## `concurrency` — running tests at once

Tests run one at a time by default.

```yaml
concurrency: 4
```

or `blastproof run --concurrency 4` for a single invocation.

On this repository's own suite that takes a run from 156s to 68s — **2.3×
faster, for the same 82 model calls.** Parallelism buys wall-clock time, not
spend.

### Why the default is 1, and why raising it is your decision

Other test runners default to parallel because their tests are isolated by
construction: separate processes, separate fixtures, separate databases. These
are journeys driven against **one running application**, so two tests can see
each other's data.

A suite is safe to parallelise when its tests do not write state that another
test reads.

### The shape that cannot run beside itself

The test in this repository's own suite that fails under concurrency is worth
recognising, because the pattern is common. It adds a note, then asserts *"one
note on file"*.

It **writes shared server state**, and it **asserts on a global count**. Either
alone is a warning. Together they mean the test's verdict depends on nothing
else touching the application at that moment — which is exactly what concurrency
removes.

Rewriting such a test to assert on its own note rather than the total makes it
safe to parallelise, and is a better test regardless.

### Two practical consequences

Four concurrent journeys are **four times the traffic** against whatever you
pointed at. Usually fine for a development instance; worth knowing before you
aim it at something shared.

With several model calls in flight, a `budget:` limit can **overshoot by up to
the concurrency** rather than by a single call, because calls already sent are
allowed to finish rather than being torn down mid-flight.

## `budget` — bounding what a run spends

Nothing stops a run by default. `budget:` puts a ceiling on `run`, `plan` and
`test` alike — every model call any of them makes is counted, with no exceptions.

```yaml
budget:
  max_llm_calls: 500
  max_tokens: 2000000
  max_duration_s: 900
```

Each limit is optional; with none set, nothing binds.

### Calls and tokens, not currency

A price table keyed by model and provider goes stale the day a provider
reprices, and is wrong from the start for anyone behind a gateway. A limit that
quietly stops meaning what it says is worse than no limit at all, **because it
is trusted**.

### Exhaustion stops the run; it does not fail a test

Running out of quota says nothing about the code under review.

Unreached tests are reported as `not run` — a third state, excluded from the
score entirely rather than counted as failures. The process exits 1
unconditionally, and `--min-score` cannot rescue it: the tests that finished are
whichever happened to run first, not a representative sample of the suite.

### Sizing a limit from evidence

Every run reports what it spent:

```
Spent: 82 model call(s), 115407 token(s)
Score: 100
```

The same figures land in the JUnit report as `llm_calls` and `llm_tokens`,
beside `score`, so a pipeline can trend cost without scraping console output. A
run stopped by its own budget reports its spend too — the case where the number
is least guessable. Where a provider reports no token usage at all, the line
says so rather than showing a misleading zero.

`--dry-run` reports the **ceiling** before you spend anything. Read it as a
maximum and nothing more: for this repository's own suite it says 735 calls
where a real run spends 82. Size a budget from what your runs actually report.

### An order of magnitude

This repository's own suite — 7 tests, 31 steps, an authenticated demo shop,
`anthropic/claude-haiku-4.5` — spends about **82 model calls and 115k tokens**,
taking 156s serially or 68s at `--concurrency 4`.

That is reproducible rather than forecast:

```bash
node examples/demo-app/serve.mjs 4173 &
blastproof run
```

Your figures will differ. Cost scales with the number of steps, how dense your
pages are, and how often the agent has to retry. Run yours once and read the
`Spent:` line.

## `max_retries_per_step`

How many failed attempts a single step tolerates before failing. Default 3.

A failed attempt is a malformed model response, a browser error, an element that
could not be resolved, a refused repeat action, or an assertion the judge
rejected against a settled page. Raising this makes a flaky step more likely to
recover and a genuinely broken one slower to report.

Separate from the hard ceiling of 15 model actions per step, which exists to stop
a step that is making progress in a loop rather than failing.

## `routes` and `ignore`

The impact map — which changed files can affect which pages. The key is the file
glob, the value is the routes; written the other way round it matches nothing,
and blastproof refuses it rather than reporting an unaffected diff.

```yaml
routes:
  "src/cart/**": ["/cart", "/checkout"]
ignore:
  - "**/*.md"
```

Explained in full in the README under
[Impact mapping](../README.md#impact-mapping), since it is the part most worth
reading before deciding whether the tool fits.

## `allowed_origins`

Extra origins the agent may reach beyond `base_url`'s own — an identity
provider, a hosted payment step.

```yaml
allowed_origins:
  - https://login.example.com
```

The boundary and why it is enforced by comparison rather than instruction is
covered in the README under
[Trust boundaries](../README.md#trust-boundaries).

## `auth`

Signing in once per run. See [Testing behind a login](./auth.md).
