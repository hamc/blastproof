# Tasks: deterministic-verdicts

## 1. Carry a temperature on the call

- [x] 1.1 `src/llm/brain.ts` — widen `GenerateObjectFn` with an optional `temperature: number`. It is narrowed deliberately so tests can inject a stub, so this is the surface that lets a test assert what was sent (design D3)
- [x] 1.2 Unit test: the stub records the options it received, so the assertions below read a real call rather than a mock's configuration

## 2. Pin the judge, and only the judge

- [x] 2.1 `createBrain.judge` — pass `temperature: 0` (design D1)
- [x] 2.2 `createBrain.nextAction` — pass nothing, and say why in a comment: latitude here is the self-healing behaviour, not an oversight. Without the comment the next reader "fixes" the inconsistency
- [x] 2.3 `createPlanner` — pass nothing, same reasoning, a person reads the draft first
- [x] 2.4 Unit tests: judging sends `temperature: 0`; the action call and the planner call send none. Assert the absence, not just the presence — a change that pins everything must fail

## 3. Say what it does not buy

- [x] 3.1 `README.md` — the verdict is pinned; repeatability is not guaranteed, and name what remains (provider batching, gateway routing between providers or quantizations)
- [x] 3.2 `docs/configuration.md` — same, next to the provider settings, where someone choosing a gateway will be reading
- [x] 3.3 Do not add a config key, and do not describe one (design D2)

## 4. Verification

- [x] 4.1 Mutation: pin `nextAction` too and confirm a test fails — the self-healing regression this change exists to avoid must be caught, not just avoided by hand. **Caught.** A third mutation, pinning the planner, is caught too
- [x] 4.2 Mutation: remove the pin from `judge` and confirm a test fails
- [x] 4.3 `npm run build`
- [x] 4.4 `npm run typecheck`
- [x] 4.5 `npm test`
