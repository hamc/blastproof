# Tasks: name-what-blocks-the-click

## 1. The translation
- [x] 1.1 In `src/runner/actions.ts`, recognise Playwright's interception line and capture the element that took the event, truncated (D2).
- [x] 1.2 Build the obstruction message: the target is fine, this is what took the click, here are the two exits, re-targeting will not help (D3).
- [x] 1.3 Guard the whole of `performAction` rather than the four locator call sites (D1). Any error carrying no interception passes through unchanged.

## 2. The rule
- [x] 2.1 One rule in `agentSystemPrompt()`, beside the existing "choose an alternative element" rule rather than replacing it (D4). It names the stacking case.

## 3. Tests
- [x] 3.1 Pin the message against a real Playwright timeout string, call log included (Risks: this is the coupling, and it must fail loudly).
- [x] 3.2 `fill` and `select` blocked the same way are translated identically (D1).
- [x] 3.3 An `Element not found` and a generic failure reach the caller unchanged.
- [x] 3.4 Executor-level: an obstructed action costs one failed attempt and the message reaches the next prompt as `lastResult`.
- [x] 3.5 The prompt states the rule, in `containment.test.ts`'s style of asserting on prompt content.

## 4. Verification
- [x] 4.1 `npm run build`, `npm run typecheck`, `npm test` green — 552 tests, 33 files.

  **The new tests are load-bearing, confirmed by mutation.** With `obstructionFor`'s
  match forced to `null` — the translation off, every other line unchanged — six of
  them fail: all five message assertions in `tests/actions.test.ts` and the executor's
  `reaches the next prompt as an obstruction naming the blocker`. The three that stay
  green with the mutation are the ones that should: two assert the untouched path (an
  unrelated failure reaches the caller as the same object, an unresolvable target still
  reads as `Element not found`), and the executor's budget/dismissal tests assert
  behaviour rather than wording.
- [x] 4.2 Live, against an application that stacks overlays on first load: the run gets past the first screen, and the dismissal appears in the step record as an action the model chose.

  **Run against OWASP Juice Shop on `http://localhost:3000`, by the reporter who filed the
  original evaluation, `anthropic/claude-haiku-4.5` via OpenRouter on both sides.** Two rounds. The
  first was inconclusive by construction and is recorded below because its flaw is the reason the
  second exists. The second: seven replicas of the published `blastproof@0.15.0` against six of
  the local build, on a reproduction test whose blocked step clicks the cookie banner while the
  welcome dialog's backdrop is over it.

  | | published 0.15.0 | with this change |
  |---|---|---|
  | passed | 5 | 5 |
  | failed, blind retry of the same click | **2** | **0** |
  | failed, provider API error after recovery had already worked | 0 | 1 |
  | named the obstruction and acted on it | n/a | **6 of 6** |

  **The fault is real, and it is probabilistic.** Both unfixed failures carried the original
  signature exactly — three retries of the same click under different names, `Escape` never
  attempted. That is what the first round failed to produce and what makes this round worth
  something. It is also why `0 of 2` was never a behaviour: five of seven cleared the block
  unaided, because the model guesses `Escape` from the raw call log often enough.

  **What is established, and what is not.** Not the rate: 2/7 against 0/6 is Fisher one-sided
  **p = 0.27**, and zero events in six replicas is consistent with a true failure rate up to about
  39%. Quoting "eliminates the failure mode 6 out of 6" as a result overstates what six runs can
  carry. What *is* established at this sample size is the policy, which is categorical rather than
  statistical: with the diagnosis in hand the model named the obstruction and acted on it in every
  one of six replicas — five via `Escape`, once by clicking `Close Welcome Banner` directly — and
  blind-retried in none. Blind retry is the behaviour that defined the failure, and it did not
  occur.

  **The rate is also confounded.** The reporter disclosed that replicas 6 and 7 were launched as
  six concurrent processes against one provider. Every anomaly in the experiment falls in that
  batch: both unfixed failures, and the fixed arm's API error. The signature is not in doubt — it
  matches an observation made without contention — but `2/7` should not be quoted as the fault's
  frequency.

  **Secondary confirmations**, all as designed:

  - The message names the **backdrop** (`<div class="cdk-overlay-backdrop cdk-overlay-dark-backdrop
    cdk-overlay-backdrop-…>`), not the target, identically across replicas — the failure mode task
    3.1 exists to catch did not occur against a real page.
  - No regression: the reporter's curated `home.yaml` and `login.yaml` gave `2 passed, 0 failed,
    Score: 100` on the local build.
  - Cost unchanged: one failed attempt per blocked step both sides, ~10 model calls, ~21k tokens,
    52–58s. This change neither pays for itself in retries nor costs anything in them.
  - D5 held: no overlay was cleared by the executor. `-> press [Escape] :: ok` appears in the log
    in the same form as every other action the model chose.
  - One replica showed a repeated click correctly refused by `StepRecovery` mid-recovery — the
    `contained-recovery` guarantee operating inside this change's path, with no interaction between
    them.

  **The first round was flawed, and the flaw is recorded so it is not repeated.** It ran four
  replicas of the unfixed build, all four recovered, and it concluded there was no failure baseline
  at all. Its reproduction test was a reconstruction of the draft that originally failed rather
  than that draft, its step read `click … to dismiss the cookie message and verify the cookie
  banner is gone` — wording that plausibly primes the dismissal being measured — and no failure
  baseline was established before the A/B, so a pass on both sides could never have separated the
  builds. `notes-plan-quality.md` had already concluded that pass rate is the wrong acceptance
  criterion, for `plan`; the same mistake was made again here and only the larger sample caught it.

## 5. Follow-ups this verification produced

- [x] 5.1 The experiment that would actually settle the value: a fixture in `examples/demo-app`
  carrying an overlay `Escape` cannot close. That is the failure baseline the A/B never had, and
  it is where the argument for a named blocker over a generic guess is either confirmed or
  dropped.

  **`examples/demo-app/consent.html`** — a consent wall over the ordinary product page. Three
  properties, each chosen against something the Juice Shop verification could not test, and all
  three confirmed with Playwright directly:

  - **`Escape` does nothing.** No `keydown` handler exists on the page. This is the whole point:
    the published build cleared the Juice Shop block four times out of four by guessing `Escape`,
    which works because a CDK dialog closes on it by default. A cookie wall, a `disableClose`
    dialog and a loading shade do not, and the guess has nowhere to go.
  - **The blocked target stays fully in the accessibility tree.** The backdrop is a bare `div`
    with no role and no name, so it never appears in a snapshot, and the content behind it is
    deliberately **not** `aria-hidden` — unlike a CDK modal, which hides the rest of the page and
    thereby hands the agent an obvious hint. Verified: the snapshot contains `button "Add to
    cart"` and nothing resembling the backdrop. The agent's only evidence of the obstruction is
    the failure message, which is precisely the condition this change exists for.
  - **The dismiss control is present and named** (`button "Accept cookies"`), alongside a decoy
    `link "Learn more about cookies"` — the shape the evaluation's weaker model clicked by
    mistake.

  **Verified end to end through `performAction`, against the live page.** A cold click is
  refused with the real message, naming the real blocker:

  ```
  blocked: the click on role=button name="Add to cart" was NOT performed. The target was found
  and is visible, enabled and stable — nothing about it is wrong. <div id="consent-backdrop"
  class="consent-backdrop"> is on top of it and received the pointer event instead. […]
  ```

  A `press Escape` changes nothing and the click is refused identically. A click on `Accept
  cookies` clears the wall and the original click then returns `ok: clicked role=button
  name="Add to cart"`. So the fixture is a genuine failure baseline: unlike Juice Shop, it cannot
  be cleared by the move the published build got lucky with.

  Noted rather than fixed: the message offers `Escape` as one of its two exits, and on this page
  that exit is a dead end. It is listed second, after the overlay's own control, and a wasted
  attempt on it still leaves the step inside its retry budget. The Juice Shop round makes this
  worth watching — five of six replicas reached for `Escape` first, and only one went straight to
  the overlay's control — so on a wall that never yields, the ordering is the first thing to
  revisit if recovery costs more than one attempt.

- [ ] 5.3 The round that would settle the rate, now that 5.1 makes it cheap: five replicas per arm
  against `consent.html`, run **sequentially** rather than in parallel, since contention confounded
  every anomaly in the Juice Shop round. Against Juice Shop's ~quarter failure rate, separating the
  arms at p < 0.05 needs roughly fifteen replicas each; against a wall `Escape` cannot open the
  unfixed arm should fail every time, and 5 against 5 reaches **p = 0.004**.
- [ ] 5.2 Adjacent gap, confirmed live and belonging to **#13** (`the report says what failed,
  never what happened`), not to #78 which is about scoring: the HTML report renders only the step
  text and its verdict. `StepResult` already carries `iterations` and `failedAttempts`
  (`src/runner/executor.ts:79-87`) and `renderSteps` (`src/report/html.ts:107-117`) renders
  neither, so a step that passed on its third attempt is indistinguishable from one that passed
  on its first. The recovery this change is about is invisible in the artefact meant for human
  review. The data is already there.
