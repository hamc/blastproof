# Proposal: deterministic-verdicts

## Why

Nothing in `src/llm/brain.ts` sets a temperature, so every model call runs at the provider's default — typically 1.0. A verdict is therefore sampled rather than computed.

An outside evaluation drove blastproof against OWASP Juice Shop and got **Score 0 and then Score 100 from the same test, run twice, with nothing changed between** (#81). That number is what `--min-score` gates a merge on. A gate that flips on identical input is worth less than no gate, because it teaches people to re-run until green.

## What Changes

- `GenerateObjectFn` carries an optional `temperature`, and `createBrain` sets it per call rather than per model
- **`judge` is pinned to 0.** Its job is to decide, and two decisions on one page must agree
- **`nextAction` is left at the provider default.** It is the self-healing loop; latitude there is the feature that re-resolves an element after a redesign instead of failing on it
- `createPlanner` is left at the provider default: a draft is read by a person before it runs
- The README and `docs/configuration.md` state what pinning does and does not buy

## Capabilities

### Modified Capabilities

- `agentic-execution`: a judgment is a decision, not a sample — the call that makes it is pinned, and the calls that explore are not

## Impact

- New dependencies: **none**. `temperature` is a standard setting the AI SDK normalises across Anthropic, OpenAI and OpenAI-compatible gateways
- Affects: `src/llm/brain.ts`, the stub type its tests inject, README, `docs/configuration.md`
- No config surface, no flag, no behaviour change for a passing suite

## Non-goals

- **No configurable temperature.** A key that can be set wrong in a way nobody notices until a gate flips is worse than a constant. Revisit if a real workload wants it
- **No claim of determinism.** Provider batching, floating point and gateway routing between providers all remain; this narrows the distribution, and the documentation says exactly that
- **No pinning of `nextAction` or the planner.** Different jobs, opposite requirements
- **No double-judging to detect disagreement.** Judging each assertion twice would make a flipped verdict visible rather than merely rarer, at one extra call per assertion. It is the better fix and it is a different change
