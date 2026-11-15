## Context

`executeTest` runs one loop per step: settle, snapshot, `brain.nextAction`, then one of four paths. `done` closes the step when something succeeded. `assert` (and a `done` that closes a check) asks `brain.judge`. `fail` fails it. Anything else is bound to its ref (`bindTarget`), checked against the step's record (`recovery.refusalFor`), performed, and recorded.

`StepRecovery` already holds what a replay needs: for each action that succeeded, the action, the role and name the snapshot showed, and the value as the model wrote it, before `{{env.*}}` is resolved. The page the model reads is masked, so a name or a claim taken from it holds `[redacted NAME]` and never a secret.

The loop also knows whether an action changed the page: `pageChangeNote` compares the snapshot the action was decided on with the next one, refs aside.

## Goals / Non-Goals

**Goals:**

- A run on an unchanged application asks the model for no action.
- A replayed action is held to every guarantee a model's action is, without restating any of them.
- A replay can cost a model call. It cannot decide a verdict the live page does not support.

**Non-Goals:**

- Fewer judge calls. The judge's variance stays, and so does its corpus.
- Speed as a goal of its own. It follows from the calls not made.

## Decisions

### D1. A replay is another source of the next decision

```ts
const action = replay?.next(refs) ?? (await brain.nextAction({ … }));
```

The saved decision enters at the point a model's decision does, so `bindTarget`, `refusalFor`, the value-source check, the verification-step rule, `performAction`, the origin check before every snapshot and the judge all apply to it as written. No guarantee is restated for the replay, so none can be forgotten for it. A guarantee placed at a call site instead of at the choke point is this codebase's recurring defect (the secret leaks, #15).

The alternative was a separate replay loop that performs the saved actions and then hands over. It would be shorter to read and would need its own copy of each check. Rejected for that.

A replayed action counts toward `maxIterationsPerStep`. It does not count as a failed attempt when it ends the replay (D4).

### D2. What is saved

Per test, when the whole test passed and the run was not stopped:

```jsonc
{
  "version": 1,
  "device": "Pixel 7",                 // or absent
  "steps": [
    {
      "key": "<sha256 of position, step as written, step as judged>",
      "actions": [
        { "action": "fill",  "role": "textbox", "name": "Note", "value": "Order not received", "changed": true },
        { "action": "click", "role": "button",  "name": "Add note", "changed": true }
      ],
      "close": { "by": "judgment", "claim": "The note \"Order not received\" is in the list" }
    }
  ]
}
```

- **`actions`** are the step's successful actions in order, from the same record the commit-repeat check reads. Failed attempts, refusals and failed assertions are not saved: the replay is the path that worked, not the search for it.
- **`changed`** is whether the next snapshot differed from the one the action was decided on, refs aside.
- **`close`** is `done`, or `judgment` with the claim the judge passed. A step that passed by the judgment before failing (#44) saves `judgment` with the check as its claim.
- **`key`** covers the step's position, its text as written and its text as judged, so editing the step or the check that follows it drops the entry. `device` is compared too: a phone layout is another interface.

Not in the key: the model, `base_url`, the branch, the blastproof version. A saved path is validated against the live page on every use (D3, D4), so a stale or foreign entry costs a model call and nothing else. `version` covers a change of this format.

Nothing here is a selector. A role and a name are what the snapshot shows and what `bindTarget` already compares.

### D3. Finding the element again

A saved target is matched against the fresh snapshot's index of refs, by role and by name compared as the commit-repeat identity compares them (case-insensitive, whitespace collapsed; inline text when there is no name). **Exactly one match gives the ref. None or several end the replay.**

Several matches could be told apart by position. That is the "first hit" the refs change removed (#60, #132), and a wrong click that succeeds leaves nothing in the report. The model reads the page and chooses, which is what it is for.

A press with no target is replayed with no target.

### D4. When a replay ends

The replay of a step ends, and the model is asked from that point on with the step's record as it stands, when:

1. a saved target has no match or several (D3);
2. `bindTarget` or `refusalFor` refuses the action, or the value's source is no longer on the page or in the step;
3. `performAction` throws;
4. a saved action had `changed: true` and the page does not differ after it, watched for the time `pageChangedWithin` already watches;
5. the step closed by judgment and the judgment fails, after the existing re-observation.

None of these spends the retry budget. The budget counts the model's attempts, and the model has made none. A replay is used once per step and never resumed.

What was performed before the end stays performed and recorded, so the model that takes over cannot repeat a commit the replay made. That is the answer to #144's open question about `contained-recovery`: the replay writes to the same record.

**Rule 4 is what keeps a silent no-op from passing a step.** A replay is faster than a model, so a page that renders late could look unchanged. The watch covers that, and when it does not, the cost is a model call.

### D5. How a replayed step closes

- **`judgment`:** after the saved actions, `brain.judge` is asked exactly as for an `assert`, with the saved claim and the live page. A pass closes the step. This is the same question the first run asked, about today's page.
- **`done`:** the step closes when every saved action was performed and rule 4 held for each. On the first run this step closed on `recovery.acted` and the model's word. The replay keeps the first and replaces the second with the page having changed where it changed before, which is more than the word was.
- **A verification step** has no actions: its entry is a claim, and the replay is one judgment. It saves the `nextAction` call that wrote the claim.

A claim written for yesterday's page can be false today. The judge decides the step and reads the claim as support (`judge-the-step`), so a false claim fails the judgment, the replay ends, and the model looks at the page and writes a new one.

### D6. Saving and dropping

- A test's file is written once, when the test passed, by a temporary file and a rename. With `concurrency` above 1 each test writes only its own file.
- A step whose replay ended is dropped from the file at the end of the test, pass or fail. If the test passed, the path the model found replaces it. An entry that failed once is never replayed again.
- A failed test saves nothing new and keeps the entries of the steps that replayed to the end.
- A stopped run (budget, deadline, provider) writes nothing.

### D7. Where it lives

`.blastproof/cache/replay/<name>-<hash of the test's path>.json`, beside `reports/` and `sessions/`, and git-ignored by `init`. It holds element names and claims from the masked page: the same content the reports hold, and no secret.

Committing it was considered, since a reviewer could then read the path a test takes. It would also make every interface change a diff in files nobody wrote, and merge conflicts in them. A disposable file avoids both.

### D8. Off by default

`replay: true` in the config, `--replay` and `--no-replay` on `run` and `test`, `BLASTPROOF_REPLAY`. A first run after turning it on is today's run. The second differs.

Off by default for the reason `concurrency` is: a gate must not start deciding differently on an upgrade. D5's `done` rule is a new way for a step to pass, and the acceptance runs in the proposal are what will say whether it should become the default.

### D9. What is reported

Each step's result carries how it was decided: `replayed`, `model`, or `healed` (the replay ended and the model finished it). The terminal summary gains one line:

```
Replay: 21 steps replayed, 2 resolved by the model (1 healed)
```

The HTML report labels a replayed or healed step, and JUnit carries the three counts as properties. A `healed` step is the signal #78 asks for in another form: the test passed, but not by the path it took last time.

## Risks / Trade-offs

- **A replayed action that succeeds on a page that now means something else.** A button of the same name that used to open a dialog and now deletes at once. The model would most likely have clicked it too, since it reads the same name. → Not mitigated. Named in the docs.
- **A value copied from a page that changes every run** ("the code shown on the confirmation page"). The saved value is yesterday's. The source check refuses it when it is not on today's page, and the replay ends. A short value that happens to be there passes, as it does for a model. → The docs say to turn the replay off for such a test, and a per-test switch is left for when someone needs it.
- **A step that needs a different number of presses each run** ("Next until the last page"). The saved count is replayed. Too many is refused or leaves the page unchanged (rule 4). Too few fails the judgment (rule 5) or, for a `done` step, closes early. → The `done` case is a real miss. `docs/writing-tests.md` already asks for an outcome on such a step, and with one it is caught.
- **A stale file makes every step heal**, and costs more than no file. → Bounded at one ended replay per step.
- **The first run's path was lucky or odd**, and is now what every run does. → It passed the same judge. `--no-replay` on a schedule samples a fresh path.

## Open Questions

- Whether `healed` should weigh on the score (#78). Not in this change: it is reported and counted first.
- Whether the composite action should save and restore `.blastproof/cache/` itself. Left to a documented `actions/cache` step until someone asks.
