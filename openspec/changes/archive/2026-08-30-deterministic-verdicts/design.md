# Design: deterministic-verdicts

## Context

`createBrain` (`src/llm/brain.ts:82`) returns two methods that call the same model through the same narrowed `generateObject` wrapper, and neither passes a temperature. `createPlanner` is a third caller with the same omission. The AI SDK defaults to the provider's own default, which is 1.0 for the providers blastproof supports.

The three calls do different jobs, and the omission costs them differently. `nextAction` chooses the next gesture from a snapshot; when a page has moved, its freedom to choose differently is the self-healing behaviour the whole tool is built around. `judge` decides whether a step passed. `draft` writes a test a person will read before running.

Only one of those is a decision that must not move.

## Goals / Non-Goals

**Goals:**
- The same page and expectation reach the same verdict
- Self-healing keeps the latitude it needs
- The limits of that guarantee are written down where a user reads them

**Non-Goals:** a configuration key, a claim of reproducibility, changes to the planner or the executor's action choice, detecting a disagreement when one happens anyway.

## Decisions

### D1: Pin the judge, and only the judge
`judge` is called with `temperature: 0`. `nextAction` and the planner's `draft` are left untouched.

The distinction is the whole change, so it is worth stating plainly: **latitude is a feature where the model is searching, and a defect where it is deciding.** `nextAction` searches — it is handed a snapshot of a page that may have been redesigned since the test was written, and asked what to do about it. Sampling is how it finds a route the author did not anticipate; that is `self-healing` in one sentence. `judge` decides — it is handed a claim and asked whether the page supports it. There is no search there, and nothing to gain from variance.

Pinning both was rejected as the obvious mistake this change exists to avoid. It would trade a real flakiness problem for a quiet regression in the behaviour that distinguishes the product, and the regression would be invisible: a suite that self-heals less does not fail, it just starts reporting defects that are not there, which reads as the same flakiness from the other side.

Pinning neither and adding retries was also rejected. Re-running a sampled judgment until it agrees with itself is a slower way of sampling.

### D2: A constant, not a config key
The value is `0` in the source, not `judge_temperature` in `config.yaml`.

A key here has a specific failure mode: it is set once, forgotten, and surfaces months later as a gate that flips, at which point nobody connects the two. The tool's own conventions push the same way — `concurrency` is opt-in and defaults to 1 because a wrong value produces failures the user cannot attribute (`AGENTS.md`), and this is that shape exactly, with a smaller blast radius and a subtler symptom.

If a real workload turns up that wants a judge to explore, that is evidence, and evidence is what should buy the key. There is none today.

### D3: `temperature` belongs to the call, not to the model
It is added to `GenerateObjectFn` and passed per call, rather than baked into the model object returned by `createModel`.

The alternative — configuring the provider once — reads as simpler and forecloses D1: one model instance cannot be pinned for judging and free for acting. Two model instances would work and would mean every consumer of `createModel` learning which one to ask for, to express something that is a property of the question rather than of the model.

`GenerateObjectFn` is narrowed on purpose ("so tests can inject a stub"), so widening it is deliberate surface: the stubs in `tests/brain.test.ts` see the new field and can assert on it, which is how D1 gets a test at all.

### D4: The documentation states the limit, not the intent
`temperature: 0` narrows a distribution. It does not survive provider-side batching, floating-point non-associativity, or a gateway routing two calls to different providers or quantizations — and OpenRouter, which the reported failure used, does exactly that.

So the README says the verdict is pinned and that repeatability is not guaranteed. Claiming determinism would be the same class of error as the authoring check's English-only silence: a guarantee the user believes and the code does not make. That comparison is in `references/authoring.md` already, and the same standard applies here.

## Rejected alternatives

- **Pin every call** — trades flakiness for a silent loss of self-healing (D1)
- **Pin nothing, retry the judgment** — sampling more slowly (D1)
- **A `judge_temperature` config key** — a wrong value surfaces as an unattributable flipped gate (D2)
- **Set temperature on the model in `createModel`** — one instance cannot be both pinned and free (D3)
- **Judge twice and report disagreement** — the better guarantee, and a different change with a real cost per assertion; noted in the proposal's non-goals so it is not lost

## Risks / Trade-offs

- **A pinned judge is consistently wrong where it was previously sometimes right.** Variance occasionally rescued a marginal call. That is not a loss worth keeping — a verdict that is right by luck cannot be relied on either way — but the failure rate on a marginal expectation may look worse before it looks better.
- **This does not fix the reported symptom, it narrows it.** If the Juice Shop search test still flips after this lands, the cause is elsewhere and the next place to look is gateway routing.
- **The evidence is one external evaluation.** Two runs of one test on one application, with one model, through one gateway. The mechanism is certain — nothing sets a temperature — but the size of the effect is not measured, and this change does not measure it.

## Migration Plan

Nothing to migrate. No config, no flag, no file format. A suite that passes today passes after, with less variance around the marginal cases.

## Open Questions

- **Does it hold on the application that produced the report?** The honest test is the Juice Shop suite, re-run several times, not `examples/demo-app`.
- **How often did this actually fire before?** Unknown, and unmeasurable retrospectively — a flipped verdict left no mark in any report.
- **Does the planner want pinning too?** Argued no here, on the grounds that a person reads the draft. If drafts turn out to vary in quality rather than in wording, that argument is wrong.
