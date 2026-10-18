## Why

Every judgment in a run is an LLM call, and judging is about a third of a run's calls. #174 measured two decision models, `liquid/d1-ultra` and `typesafe/jev-1.13`, as a first pass in front of the LLM judge (`docs/model-evaluations/decision-models.md`). Neither let a planted bug through in 162 runs, and on a real budgeting app every run with one was 15–17% cheaper and 11–13% faster. A decision model answers yes or no with a probability, for $0.042 per million input tokens, and gives no reason. A reason is how wrong passes were diagnosed before (#87, #120, #147), so this ships off by default, as an experimental option (#184).

## What Changes

- A new optional config section, `first_judge:`, naming a model on OpenRouter's Decisions API, the variable holding its key (default `OPENROUTER_API_KEY`) and a threshold (default 0.7). Absent, nothing changes. Present with the key unset, the run refuses to start with the missing-key message's standard.
- When it is set, every judgment asks the decision model first, with the LLM judge's own input (placeholders as labels, refs removed).
  - At or above the threshold, the step passes without an LLM call, after the same label check every LLM pass goes through.
  - Below the threshold, the judgment goes to the LLM judge, which decides it and writes the reason, as today. So does a page too large for the model, and an answer that cannot be read.
- Its calls go through the same choke point as every model call: the budget counts them, `llm.timeout_s` and the deadline bound them, and a refusal from the provider stops the run.
- The run's summary says how many judgments the first judge passed and how many it sent to the LLM.
- Every judgment it makes is written to `first-judge.jsonl` in the run's report directory: the step, the claim, the masked page it read, the probability and what was done with it. A pass has no reason, so the page it read is what remains.
- `BLASTPROOF_FIRST_JUDGE_MODEL` and `BLASTPROOF_FIRST_JUDGE_THRESHOLD` override it from the environment. That lets the reliability benchmark measure it without code of its own.
- The six number and date mutants used in #174 join `evals/reliability/`. `evals/judge/jev.ts` replays the corpus through the product's own first judge rather than a copy of it.

## Non-goals

- **Making it the default**, or a decision model the only judge. A failure needs a reason, because the agent's retry and the report read it.
- **Other roles.** Choosing an action and drafting tests need text, and a decision model generates none.
- **Other providers' decision endpoints.** OpenRouter's is the only one measured.
- **Pricing in dollars.** The budget counts calls and tokens, as it does for the LLM.

## Capabilities

### New Capabilities

- `first-judge`: the opt-in decision model in front of the LLM judge: configuration, when it decides and when it defers, the label check, and what a run keeps of its judgments.

### Modified Capabilities

- `run-budget`: the worst-case call ceiling counts the extra call a deferred judgment makes.
- `config-overrides`: two new environment overrides.

## Impact

- `src/config.ts`: the `first_judge` schema and its overrides.
- `src/llm/decision.ts` (new): the Decisions API client.
- `src/llm/brain.ts`: `judge()` asks it first; `countedGenerate` gives the budget, the timeout and the refusal handling to it as well.
- `src/llm/prompts.ts`: the question it is asked, shared with the eval.
- `src/runner/budget.ts`, `src/commands/run.ts`: the ceiling, the summary line, the jsonl file.
- No new dependency: the client is a `fetch`.
- Documentation: `docs/configuration.md`, the evaluation page, the site article and the CHANGELOG.
