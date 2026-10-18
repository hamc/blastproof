## Context

`brain.judge()` makes one LLM call through `countedGenerate`, which holds the budget check, the per-call abort (timeout and deadline), the usage record and the conversion of a provider's error into a stop of the run. It then applies `secretMismatch`, the label check. The executor calls `judge()` for an `assert`, a judged `done` and the re-observation after a failed judgment, and `auth.ts` calls it to verify a login.

#174's measurements came from `evals/judge/jev.ts` and an unmerged prototype wired into `judge()` behind an environment variable. The prototype was deleted, so this design rebuilds it from the issue's list. Where the prototype's choices were measured, this design keeps them: the instructions and criteria in `jev.ts`, the threshold of 0.7, and the label check over every pass.

## Goals / Non-Goals

**Goals:**

- Ask exactly what was measured, so #174's numbers describe what ships.
- Keep every run-wide guarantee (budget, timeout, deadline, refusal) at the one choke point.
- Keep a failure's reason from the LLM judge or the label check.

**Non-Goals:**

- Tuning the question or the threshold. Both were measured, and changing either means measuring again.

## Decisions

### D1. A top-level `first_judge:` section, not a field of `llm:`

```yaml
first_judge:            # experimental
  model: liquid/d1-ultra
  api_key_env: OPENROUTER_API_KEY   # default
  threshold: 0.7                    # default
```

`llm:` describes one provider, and every field in it (`provider`, `base_url`, `extra_body`, `timeout_s`) means something for that provider. A decision model has its own endpoint, key and API. Nesting it there would suggest it inherits `llm.base_url` or `extra_body`, and it does not.

It is top-level rather than under an `experimental:` section because `ENV_OVERRIDES` maps paths of two segments, and the summary line and the docs already say "experimental". Moving it later is a config rename that the unknown-key error reports.

`model` has no default. The measured models are on an `alpha` endpoint, and a name that might be retired is better written by the user than shipped by us.

### D2. A `fetch` client that throws what the SDK throws

`src/llm/decision.ts` posts `{ model, state, questions: { pass: { type: 'noul', instructions, criteria } } }` to `https://openrouter.ai/api/alpha/decisions` and returns the `noul` probability and the usage.

Its failures are made in the shapes `countedGenerate` already converts. An HTTP error becomes an `APICallError` with the status and the response body. A network failure becomes one with no status, so `asProviderRefusal` turns both into `ProviderRefusedError`, and `withProviderDetail` quotes the body.

It retries twice on a network error, 408, 409, 429 or 5xx, with a backoff of 2 s and then 4 s. That is the AI SDK's own default for every LLM call. Without it, a single 503 on an alpha endpoint would stop a run that the LLM path would have survived. The abort signal applies across the retries.

Alternative rejected: making the decision call a `LanguageModel` so it could go through `generateObject`. The Decisions API is not a chat API, and a fake one would hide that.

### D3. One choke point, generalized

`countedGenerate` becomes a thin caller of a `counted(budget, call)` that takes any `(signal) => Promise<{ usage }>`. The budget check, the abort timer, the usage record and the error conversion stay in `counted`. Both the LLM call and the decision call go through it. AGENTS.md records why: a guarantee implemented at a call site instead of over the whole scope is this codebase's recurring defect.

The usage counts as `totalTokens`, read from the response's `usage`. The exact field names are confirmed against a live response during implementation. Absent usage is recorded as a call without tokens, which the spend line already reports honestly.

### D4. The question, in one place

The instructions are `assertSystemPrompt()` up to "Answer with pass=true/false". The state is `assertUserPrompt(...)` over the labelled step, claim and record. The criteria are the two sentences in `jev.ts`. They move to `prompts.ts` as `firstJudgeQuestion()`, and `jev.ts` imports it, so the eval replays the shipped question. A later change to the judge's system prompt changes both, which is right: the corpus replay is how either is checked.

### D5. Where it sits inside `judge()`

```
labelled input ──► too large? ──yes──────────────────────────► LLM judge (as today)
                      │no
                      ▼
               decision call (counted)
                      │
         unreadable? ─┼─ p < threshold ──────────────────────► LLM judge (as today)
                      │ p ≥ threshold
                      ▼
               secretMismatch ──fails──► FAIL, label check's reason
                      │passes
                      ▼
                    PASS (reason names model, p, threshold)
```

- **A pass the label check fails is final.** The LLM judge cannot change it: the check would fail its pass too, on the same input. Asking it would spend a call on a verdict already decided.
- **An unreadable answer goes to the LLM** (a 2xx without a probability in [0, 1]). The first judge is a shortcut, and a missing shortcut costs a call, not a wrong verdict. This differs from a malformed LLM judgment, which is a failed attempt, because that one *is* the verdict.
- **Inside `judge()`, not the executor.** Every caller, including the re-observation and the login check, gets it without knowing it exists, as they got the labels (`ask-the-judge-about-the-step`, D1).
- **`run` and `test` only.** `plan` keeps the LLM judge alone. Its only judgments are a login's, it reports no verdicts, and it has no summary to report the first judge's counts in.

### D6. "Too large" is a character bound, measured before sending

Jev takes 32k tokens for the state and the longest question. The bound is checked on the state plus the instructions, in characters, at a conservative 2 characters per token: 60,000 characters. The real app's pages were well under it (the snapshot is capped at 200 lines by default). `d1-ultra`'s documented limit is checked during implementation, and the constant takes the smaller of the two.

Alternative rejected: sending it and treating a 400 as "too large". The status does not say why, and reading the provider's prose is what the refusal handling deliberately does not do. An unknown model also answers 400, and it should stop the run, not quietly send every judgment to the LLM.

### D7. What the run keeps

- **The summary line:** `First judge (experimental, liquid/d1-ultra ≥ 0.7): 81 passed, 19 to the LLM`. The counts are held in a `FirstJudgeStats` that `run.ts` creates once per run and passes to every brain, so concurrent tests add to one total.
- **`first-judge.jsonl`** in the session directory, one JSON line per decision call: `test`, `step`, `claim`, `snapshot`, `p`, `threshold`, `outcome` (`passed` | `label-check` | `to-llm`), and the model. Judgments too large to send are counted as `to-llm` in the summary but have no line, since no decision was made. Every text is what the judge received, so it is masked by construction. Appended as it happens, so a run stopped midway keeps what it did.

The HTML report and JUnit are unchanged. The step's result line, which the terminal log shows, names the model and the probability.

### D8. The ceiling

A failing judgment makes one decision call and one LLM call, and the re-observation makes two more. The per-step ceiling `N + R + min(N, R)` counts a failing `assert` as 3 calls. With a first judge it is 5 (`nextAction` + 2 × 2), giving `N + R + 3·min(N, R)`. The derivation in `estimateMaxModelCalls`'s comment gains this case. The login journey's ceiling changes the same way.

### D9. Measuring before merge

The six #174 mutants on numbers and dates are rebuilt as the lab defined them and added to `evals/reliability/mutants.json`:

- four `literal` mutants, each changing a value a step quotes: $114.00 or $14.10 for the $141.00 total spent, a cart total 60 cents high, and an order dated a day late;
- two `subtle` mutants naming #87, the right value in the wrong place: two orders with each other's dates, and with each other's totals.

The dates and the per-order totals had no step checking them, so the lab's `orders-detail.yaml` joins the dogfood suite too. It costs one more test in every suite run, and it measures the LLM judge on these bugs as well. `BLASTPROOF_FIRST_JUDGE_MODEL` lets `npm run eval:reliability` measure the first judge with no code of its own.

## Risks / Trade-offs

- [A pass carries no reason] → the jsonl keeps the page and the probability. The option is off by default and labelled experimental in the summary.
- [The calibration was measured on one real app and one demo app] → the threshold is a setting. The docs say what it was measured on, and the jsonl lets a user check their own app.
- [The endpoint is `alpha` and may change shape] → an unreadable answer goes to the LLM, and an error status stops the run with the provider's words, so a change is visible rather than silent.
- [A failing judgment now costs two calls] → measured: runs were still 15–17% cheaper, because most judgments pass.
- [Budget limits sized for LLM calls bind sooner] → decision calls count as calls, and the docs say so. Counting them separately would weaken a guarantee to spare a number.

## Open Questions

Resolved during implementation, against the live endpoint on 2026-10-18:

- **Usage** arrives as `usage: { input_tokens, output_tokens, cost }`. Output is usually 0, and Jev reported 20 once. The client counts their sum.
- **`liquid/d1-ultra`'s limit** is 32,768 tokens or 250,000 bytes per question. Over it, the endpoint answers 422 ("over the model's input limit"). Jev accepted 30,297 tokens. The 60,000-character bound stays under both at 2 characters per token, and a snapshot runs nearer 4.
