# Changelog

All notable changes are recorded here. This project follows [semantic versioning](https://semver.org/);
while it is pre-1.0, a minor bump may change existing behaviour and a patch never does.

## [0.17.0] — 2026-09-03

### Fixed

- **An element named `Add` is no longer lost to an `Add New` above it.** The executor
  is told to target elements by their exact accessible name; the resolver matched
  that name by substring and, on a tie, took the first one in the page. It clicked,
  it succeeded, and nothing in the report could say it had acted on a control nobody
  targeted. Each strategy now asks for the exact name first and falls back to the
  substring match only when nothing matches exactly, so a name that differs by
  whitespace or truncation still works.
- **One draft that cannot be written no longer discards the rest.** `plan --write`
  contained a generation failure and let a write failure end the run — losing every
  route after it, and the summary that would have said which ones succeeded. Each of
  those drafts is a model call against a live page.

### Known limitation

- **When several visible controls share one accessible name, the first on the page
  still wins, silently.** Refusing instead was designed and then measured out: on
  real accessible sites a control's screen-reader twin shares its role and name and
  counts as visible, so the refusal would have refused ordinary navigation. Give each
  control a name no other visible control shares — a page that cannot is one this
  tool cannot drive unambiguously.

## [0.16.0] — 2026-08-31

### Added

- **An agent skill.** `npx skills add hamc/blastproof`, then tell your coding agent
  "set up e2e tests". It checks whether your markup is reachable at all, scaffolds,
  generates drafts from your running app, and writes down the accessibility
  constraints that keep the suite alive. It deliberately does not configure
  authentication or CI.

### Fixed

- **`provider: openai` works.** It never had: the schema was refused before the
  model was asked anything, so the documented default made zero model calls and
  reported only `Provider returned error`. Anthropic does not enforce the rule that
  refused it, which is why this went unseen.
- **A provider's error reaches you.** Refusals used to arrive as a short phrase with
  the provider's own explanation discarded. It is now quoted.
- **The verdict no longer varies between identical runs.** The call that judges a
  step is pinned; the calls that choose an action and draft a test are deliberately
  left free, because that latitude is the self-healing.
- **A blocked click says what is blocking it.** An overlay over a correct target
  used to arrive as a timeout, which reads as "wrong element" — so the agent kept
  re-resolving the right one. It now names what took the click and says that
  re-targeting cannot help.
- **`plan --write` creates the directory it writes into**, and a draft that cannot be
  written no longer ends the whole run. Thanks to @abhijeetnardele24-hash for the
  first outside contribution.

### Changed

- **An absent field is now sent as `null` rather than omitted.** This is what makes
  strict providers accept the request. A provider that omits a key instead will have
  its answer rejected and retried — visible, not silent. Four providers were checked
  and none does.

## [0.15.0] — 2026-08-18

### Fixed
- **An `{{env.*}}` placeholder is a source only when the step names it.** 0.14.0 stopped the agent
  typing a value it could not trace to the step, the pages it was shown, or a value it had already
  typed — and exempted any well-formed `{{env.*}}` placeholder from that check.

  The exemption is necessary: substitution happens after the check, so a placeholder is all there is
  to see, and the masked page shows `***` where the secret is. Comparing it as text would refuse
  every authenticated test. But it asked *is this a placeholder?* when what makes one legitimate is
  *did the test point this secret here?* Nothing checked the second. Given `fill the Password field`
  with no value, an adversarial run's model supplied `{{env.ACTUAL_PASSWORD}}` itself, nothing
  refused it, and the real password was typed into a field nobody aimed a secret at.

  **It also defeated the secrets mask.** The mask registers the variables your config and your tests
  reference, and only those. A variable set in the environment but named by no step was substituted
  *and never registered* — so it reached the model's next prompt and the run's reports unredacted.

  A value may now reference only the `{{env.*}}` variables its own step references. Anything else is
  refused, never substituted, at the same choke point and on the same retry budget:

  ```
  refused: the value "{{env.PASSWORD}}" was NOT typed, because this step does not reference that
  {{env.*}} variable. This step references no environment variable. A placeholder is a source only
  when the step names it …
  ```

  Names compare **exactly**: `TOKEN` and `token` are two different secrets, so unlike ordinary values
  they are not case-folded. Scope is the step being executed — not the test, not the run, since
  run-wide scope is what disguised this in the first place.

  Verified by the adversarial pass that found it, on the unreleased build: the guessed placeholder is
  refused and the model gives up honestly, and a full nine-test authenticated suite saw **zero**
  refusals with every legitimate placeholder accepted. Reported by an external adversarial QA pass
  against Actual Budget v26.8.1.

### Internal
- `runner/recovery.ts` no longer carries its own idea of what a placeholder is. It shares
  `referencedEnvVars` with substitution and masking, closing a drift where `{{ env.X }}` and
  `Bearer {{env.X}}` were substituted by one rule and unrecognised by the other.

## [0.14.0] — 2026-08-17

### Fixed
- **A value the agent made up is now refused instead of typed.** `prompts.ts` has told the executor
  *"Never invent a value"* since 0.7.0 — one it types must come from the step, from the page, or from
  an `{{env.*}}` placeholder — and nothing enforced it. Measured against `examples/demo-app` with a
  real model, a test whose only step is `fill the note field`:

  ```
  1 → fill textbox "Note" [This is a test note.]  → PASS  Score: 100
  2 → fill textbox "Note" [This is a test note.]  → PASS  Score: 100
  3 → fill textbox "Note" [This is a new note]    → PASS  Score: 100
  ```

  Three runs, three inventions, three passes, and the value differs between runs. A green test over an
  input nobody wrote is worse than a failure: the suite reports coverage of a journey it never
  specified, and nothing in the report says so, because nothing knew. 0.12.1 had to correct the
  shipped warning to admit this and named [#57](https://github.com/hamc/blastproof/issues/57) as the
  fix — which this is.

  A `fill` or `select` whose value is traceable to none of **the step, any page shown during that
  step, an `{{env.*}}` placeholder, or a value already typed in that step** is refused at the same
  choke point that already refuses a repeated commit, and spends the same retry budget. The same run
  now scores 0, with the agent's own reason naming the cause:

  ```
  -> fill textbox "Note" [This is a new note] :: refused: the value "This is a new note" was NOT
     typed, because it appears neither in this step nor anywhere on the pages you have been shown…
  -> fail :: The step requests to fill the note field but provides no value to enter…
  ```

  *"From the page"* means any snapshot shown during the step, not the one in hand — reading an order
  number on one page and typing it on another is legitimate, and comparing against only the current
  snapshot would refuse it. The comparison runs against the **masked** text the agent was actually
  shown, so a secret the mask hid can never count as a source.

  Unlike the authoring warning that predicts the same defect before a run, nothing here parses
  English: the guarantee holds for a suite written in any language.

  **Two limits, stated rather than discovered.** A value reformatted between the step and the field —
  `1234` in the step, `1,234.00` in the box — is refused; write it the way it is typed. And a very
  short value (`3`) appears somewhere in almost any page, so it passes: this closes fabricated
  content, not every fabricated character.

  **Why this is a minor and not a patch.** A suite that passed by fabricating a value now fails. Every
  `fill` step in the suite this project ships names its value — which is the rule the README already
  teaches, so enforcement is the documented contract finally being checked — but a suite relying on
  fabrication changes behaviour, and that is not a patch.

## [0.13.0] — 2026-08-12

### Fixed
- **A `routes:` map written the other way round is now refused instead of silently matching nothing.**
  `routes:` is `{ glob: [route, ...] }` — the file glob is the key. Inverted, it still type-checks,
  because both halves are a string keying a list of strings:

  ```yaml
  routes:
    "/cart": ["src/cart/**"]      # loaded fine, matched nothing, ever
  ```

  Every changed file was then compared against `/cart` as though it were a glob, fell through to
  unclassified, and `--impacted` selected zero tests. **The run exited 0 having exercised nothing**,
  and the report was indistinguishable from a diff that genuinely affected no page. `--fail-on-unmapped`
  would have caught it, but it is opt-in and fires only once the run has started.

  Writing it inverted is a reasonable first guess rather than carelessness: the key is named `routes`,
  and a test file's own `routes:` genuinely *is* a list of routes — the same word means the opposite
  thing one file away. The error now names one offending entry and shows the correction built from
  your own key and value, so the fix is visible without opening the documentation:

  ```
  error: Invalid .blastproof/config.yaml:
    - routes: is the wrong way round — the key is the file glob, the value is the routes it affects.
        found:    "/cart": ["src/cart/**"]
        expected: "src/cart/**": ["/cart"]
  ```

  It refuses rather than warns because a warning preserves the exit code, and the exit code is the
  defect. Detection requires **both** halves of an entry to look wrong, so a route holding a wildcard
  (`"src/products/**": ["/products/*"]`) and an absolute-looking glob (`"/src/cart/**": ["/cart"]`)
  both still load. Closes [#6](https://github.com/hamc/blastproof/issues/6).

  **This is why the release is a minor rather than a patch.** A configuration that loaded yesterday
  can now exit 2. No configuration that ever selected a test changes behaviour — an inverted map never
  matched a file — but a pipeline that was green *because it ran nothing* will turn red, and that is a
  behaviour change however welcome it is.

## [0.12.1] — 2026-08-12

### Fixed
- **The authoring warning promised a consequence that does not happen.** The check shipped in 0.12.0
  closed with "The runner is forbidden from inventing values, so a step that supplies none cannot be
  carried out." Measured against `examples/demo-app` with a real model, that is false: the model
  supplies a value anyway and the step **passes** — `fill the note field` was filled with "This is a
  test note." twice and "This is a new note" once, passing all three times. The prohibition lives in
  a prompt, and a prompt instructs rather than enforces.

  The harm is therefore worse than the old wording described, not milder: a green test over a value
  nobody wrote, and a different one on each run, rather than an honest failure the reader might
  misjudge. The warning, the planner prompt, the README and the `cli-run-command` requirement now say
  what was measured. Enforcing the rule in the executor is
  [#57](https://github.com/hamc/blastproof/issues/57).

  Detection, exit codes and `--fail-on-authoring` are unchanged; only what they claim about the
  outcome has been corrected.

## [0.12.0] — 2026-08-10

Two silent false negatives become visible before a run spends anything. Both warn rather than fail,
both print from a single unconditional call site so no code path can skip them, and both have an
opt-in gate for teams enforcing in CI.

### Added
- **A step that enters a value but names none is now caught before the run.** The executor has been
  forbidden from inventing values since 0.7.0 — one it types must come from the step, from the page,
  or from an `{{env.*}}` placeholder — but that rule lives in a prompt, which instructs rather than
  enforces. A step like `fill the note field` does not fail: the model makes a value up and the step
  **passes**, over an input nobody wrote and a different one on each run. Caught now before the run:

  ```
  Authoring (a step enters a value but names none):
    Add a note (.blastproof/tests/notes.yaml) step 2:
        fill the note field
      → fill the note field with <value>
  ```

  Non-fatal; `--fail-on-authoring` promotes it to exit 1, above preflight and the key check, so the
  gate costs nothing when it fires. The detector asks whether a step carries a connector rather than
  whether it names a value — enumerating the ways to name a value cannot be closed, and trying it
  flagged `set the priority to High`. Taking a value from the page is legal and is not flagged.

  **English only.** A suite written in another language runs exactly as well and is not inspected;
  the warning says so rather than letting silence read as coverage.

- **A test route no `routes:` mapping declares is now reported.** `--impacted` intersects routes by
  exact equality, so a test declaring `/cart/` against a config that maps `/cart` was never selected
  and never mentioned — the suite looked covered while a regression walked through. The same silent
  false negative `--fail-on-unmapped` prevents on the file side, now closed on the test side.
  Contributed by [@01luyicheng](https://github.com/01luyicheng).

### Fixed
- **A report that could not be written failed with a raw errno.** `EACCES: permission denied, open
  '…'` reached the user unchanged where every other error in the tool is plain prose naming what to
  do. Filesystem failures in the JUnit, HTML and `init` writers now read like the rest of the tool.

### Internal
- `fsReason` and `ReportError` are shared from `src/report/errors.ts` instead of the HTML writer
  importing them from the JUnit writer.
- The operational reference moved out of the README into `docs/`, and `CONTRIBUTING.md`'s release
  checklist now points at where the versioned Action example actually lives.

## [0.11.0] — 2026-07-31

### Fixed
- **`plan` drafted the shape this project documents as wrong.** The README leads its writing guidance
  with the rule — every step names what it should produce — and the measurement behind it: same
  application, same suite, Score 64 to 100 on two rewritten steps. The planner's prompt still taught
  the older, weaker version, "end with at least one step that verifies an observable outcome".
  Generating against this repository's own demo app produced three bare actions in a row, two of them
  naming no value at all:

  ```yaml
  - Navigate to the Support page
  - Enter a subject in the Subject textbox
  - Enter a message in the Message textbox
  ```

  The executor has refused to invent values since 0.7.0, so `plan` was drafting a test `run` is
  designed not to complete. Generated steps now name their outcome and write any value they supply.

- **The planner did not know where a run starts.** A run opens the application's base URL, not the
  route a draft was generated for. The planner had never been told, and emitted a navigation step only
  because it was listing actions naively — so tightening the rule above made it drop the navigation
  entirely, and the first draft generated under the new prompt failed on the home page. Drafts now open
  by navigating to the route and saying what should be visible there. Found by running a generated
  draft rather than reading it, which is the only reason it was found at all.

### Changed
- The planner's "one action **or** check per step" becomes "one move per step — a single action
  together with what it should produce, or a single check". The old phrasing contradicted the rule
  above, since the documented example is one action *and* its check.

### Internal
- `DEFECTS.md` said DEF-005's structural lever was "deliberately NOT taken" for a full day after 0.10.0
  took it. An outside review read the file and reported the lever as still pending, twice and in its
  conclusion — right about the file, wrong about the code. Second instance in two days of
  documentation asserting something the code had since contradicted. A defect record is a claim about
  the present, not only a diary of the past.

## [0.10.0] — 2026-07-31

### Fixed
- **A step naming a path was failed when the server redirected.** The judge compared the URL it could
  see against the path the step named, and had no way to know a redirect had happened, so it reported
  *"the navigation did not occur"* about a navigation that occurred, was reported `ok`, and was then
  retried and failed twice more.

  Measured, the trigger is narrower than it looks: same step, identical destination content, same
  model — a **same-origin** redirect passed 3 of 3, a **cross-origin** one failed 3 of 3. The
  same-origin case passing was the judge tolerating a smaller discrepancy, not the judge being right.

  This was the third defect of one family. A successful navigation to a redirecting path cannot leave
  the browser at that path, exactly as a successful submit cannot leave the form filled (0.7.0) and a
  successful action removes the control the step names (0.6.0). Each time the judge was asked whether
  something happened while looking at the state that succeeding produces, and each time the answer was
  one more description of one more shape. So this one is answered structurally instead: **a `navigate`
  now reports where it landed** when that differs from where it was asked to go, and **the judge
  receives the record of what was already done in the step** — the same record the agent gets, masked
  the same way, scoped to the step — at both judgments including the re-observation.

  The record says what was *attempted*; the snapshot remains the only evidence of what is now *true*.
  That distinction is the risk this change carries, and it was checked against the reproduction from
  0.7.0 where a successful click sits in the record while the step's outcome is absent: it still
  fails, and still leaves nothing behind.

### Changed
- A `navigate` that the server redirects now reports both URLs — `ok: navigated to <requested>, which
  redirected to <landing>` — instead of reporting arrival at the requested one. Runs that never
  redirect are unchanged.

### Internal
- **The tests are typechecked.** `tsconfig.json` excluded `tests/`, so `npm run typecheck` skipped all
  418 of them, and vitest does not fill that gap: it transpiles with esbuild, which strips type
  annotations without checking them. A test asserting on a field that does not exist read `undefined`
  and passed, and the negative forms (`toBeUndefined`, `not.toBe`) passed silently rather than failing.
  Turning it on surfaced 16 errors across 9 files; **none was a vacuous test**, but three fixtures were
  building a shape the parser can never produce, and three assertions now check that a call really
  threw before reading a message off it.
- Documentation corrections from an outside review: the architecture tree in `AGENTS.md` was missing
  three files, and the derivation above `estimateMaxModelCalls` still argued the previous formula while
  the code below it computed the current one. The rule that decides whether a suite works — every step
  names its own outcome — moved to where tests are actually written, with the measured before-and-after.

## [0.9.0] — 2026-07-31

### Added
- **Tests can run several at once.** `concurrency: 4` in the config, or `--concurrency 4` for a single
  invocation. Measured on this repository's own suite: **156s to 68s, 2.3× faster, for the same 81
  model calls and the same tokens.** Parallelism buys wall-clock, not spend.

  **The default stays 1, and raising it is a decision only you can make.** Other test runners default
  to parallel because their tests are isolated by construction — separate processes, separate
  fixtures. These are plain-English journeys driven against one running application, so two tests can
  see each other's data. The example in this repository's own suite: a test that adds a note and then
  asserts "one note on file" both writes shared server state and asserts on a global count, and cannot
  run beside itself. A tool that gates merges must not start producing failures from its own scheduler
  on upgrade.

  Above concurrency 1 each test's output is buffered and printed as one block when it finishes, since a
  step transcript is only legible read consecutively. At 1, output streams exactly as before. Results
  are reported in selection order regardless of finishing order, so a report never changes shape
  because of timing.

- **A run reports what it spent.** Every model call and every token was already counted — that is how
  `budget:` enforces its limits — and then discarded. The only cost figure the tool volunteered was
  `--dry-run`'s worst case, which is deliberately a maximum: it says 735 model calls for this
  repository's suite where a real run spends 82. Anyone sizing `max_llm_calls` from the one number
  available would set it about nine times too high.

  A finished run now prints `Spent: 82 model call(s), 115407 token(s)`, against the configured limits
  when there are any. So does a run its own budget stopped, which is where the number is least
  guessable. The figures land in the JUnit report as `llm_calls` and `llm_tokens` beside `score`, and
  in the HTML summary. Where a provider reports no token usage the line says so rather than showing
  zero, and the JUnit property is omitted rather than written as `0` — "no tokens were reported" and
  "no tokens were spent" are different claims. Not currency, for the same reason the budget itself is
  not: a price table is wrong the day a provider reprices, and wrong behind a gateway.

### Changed
- With concurrency above 1, a `budget:` limit can overshoot by up to the configured concurrency rather
  than by a single call, because calls already in flight are allowed to finish. Unchanged for a run at
  the default.

## [0.8.0] — 2026-07-31

### Fixed
- **The agent could leave the application under test, and the run reported a pass.** The origin
  boundary checked the URL a `navigate` action asked for, before the request, and nothing after it.
  Two ways out, both reproduced with a real model against two local origins: a path on the
  application's own origin answering `302` to a foreign host, and a click on a link pointing at one.
  The click case is the wider of the two — the check was called in the `navigate` branch and nowhere
  else, so a link across origins was never checked at all. Both runs reported `Score: 100`, and in
  the redirect run the judge named the foreign URL in its own reason while the run passed anyway.

  This matters beyond tidiness: once outside, that page's content went into the next prompt while
  the browser context still held the application's session, which is the exact scenario
  `agent-containment` exists to prevent. The boundary is now compared against where the page
  actually is, before every snapshot — so it covers a redirect, a click, a form submission, a script
  setting the location, and any action added later, and a page outside the boundary is never read
  into a prompt. The pre-navigation check remains, because refusing to make the request is better
  than making it and objecting afterwards.

  **This is a behavioural change.** An application that redirects across hosts without declaring
  them in `allowed_origins:` now fails the step, naming the origin to add, instead of continuing in
  silence. A suite that was quietly walking onto a foreign page was never testing what it claimed
  to. Applications that stay within their own origin see no difference.

## [0.7.0] — 2026-07-30

### Fixed
- **A failing step could write to the application under test more than once, and could write data
  nobody wrote a test for.** The shape behind it: a form is submitted, the server answers with a
  redirect back to the same page, and the form comes back reset. The state that proves the submit
  succeeded is exactly the state the submit destroys, so the snapshot after a successful submit is
  indistinguishable from one where nothing happened. The agent, which sees only the page and its own
  last result, submits again — and, observed twice, invents a value to type first. Reproduced on
  three applications with two models: Gitea (three issues where the test intended one), an external
  task manager, and a page added to this repository's demo app for the purpose, where a *negative*
  test whose intended outcome was that nothing happens left a record behind called
  `This is a test note`, a string in no test file, no page and no config.

  Within a step, an action that commits — a click, or pressing a key that activates a control — is
  no longer performed twice. The runner refuses the repeat and returns the refusal to the agent as
  that action's result. The agent is also shown the actions it has already performed in the current
  step, which is the underlying cause: it was being asked to act on a state whose history it could
  not see. Verified against the demo app's own state rather than the tool's report: the negative
  test now leaves zero records (was one), the positive test one (was two), and a well-written
  version of the same test passes with a single record.

  **This is not a guarantee of zero duplicate writes.** An agent that reaches the same effect
  through a genuinely different control is still not caught, and a legitimate retry — a commit that
  landed but had no effect — is refused as well, because from the accessibility tree that case is
  indistinguishable from a commit whose evidence a redirect erased. A refused retry costs a visible
  failed step; an allowed duplicate costs a silent row in someone's database. Keep pointing runs at
  disposable data.

## [0.6.0] — 2026-07-30

### Fixed
- **A wrong PASS.** An outside evaluation ran blastproof against a real Vikunja instance with a test
  that created a project and verified it appeared in the projects list, and got `Score: 100` twice —
  while Vikunja's own database, checked directly, showed the project was never created either time.
  The judge deciding an `assert` never saw the step it belonged to, only the model's own expectation
  for that turn, so a claim that was true and irrelevant could close a step whose real assertion had
  already failed. Two distinct malfunctions were observed against the same test: once, a step failed
  correctly and the model's next turn offered an unrelated true claim ("the 'Show Archived' checkbox
  is visible") that the judge passed, ending the step; separately, a project title sitting in an
  unsubmitted "New project" dialog's own textbox satisfied a paraphrase of "visible in the projects
  list". The judge is now given the step as the question it must answer, with the model's expectation
  offered alongside it as the claim in support — a claim that is true of the page but does not
  establish the step's own outcome no longer passes it, and a value present only in an uncommitted
  control (typed, not yet submitted) is not accepted as the committed outcome a step describes.
  `auth.verify`'s judgment now anchors on the login journey the same way.

  **This is a behavioural change, not only a bugfix.** A test whose steps do not state their own
  outcome had less for the old, unanchored judge to get wrong, and gets less benefit of the doubt now:
  a vague step ("check it worked") may start failing where it previously passed. That is the intended
  direction — a step that names the outcome it expects was already the recommended shape, and is now
  load-bearing rather than merely advisable.

## [0.5.0] — 2026-07-30

### Fixed
- **A step could be failed for a page the action had already replaced.** An outside evaluation ran
  blastproof against Gitea, filed an issue through the UI, and got a FAIL — while Gitea's own API
  confirmed the issue existed and blastproof's own failure screenshot showed it on screen. The
  executor snapshotted immediately after each action, so a click answered by a server round-trip and
  a redirect left the next snapshot showing the page being replaced; the judge then evaluated stale
  evidence and correctly concluded, about the wrong page, that nothing had happened. Compounding it,
  a failed judgment returned straight to the model rather than looking again, and in both observed
  runs the model invented a navigation instead — once fabricating an `{{env.*}}` variable that
  appeared nowhere in the test or config. Snapshots now wait for the page to settle first, and a
  failed judgment re-observes the same expectation against a freshly settled page before control
  returns to the model.

  Only network idle narrows that window: `domcontentloaded` and `load` were measured returning in
  about a millisecond on the page still being replaced. Because network idle is also the state most
  likely never to arrive, settling has a short budget of its own (2s) rather than using
  `browser.timeout_ms` — exceeding it is normal and silent, so this fails toward previous behaviour
  rather than toward a hang. An application holding a websocket or a poll therefore gets no
  protection from this fix; that limit is known and recorded.
- **A redaction read as a verification failure.** Every referenced secret becomes `***` in anything
  crossing into a prompt, and nothing told the model what that meant — so it filled a credential
  field, saw `***`, concluded the field was unverifiable and refilled it, two to three times on every
  authenticated test. In one run bounded at 8 model calls, this consumed nearly the whole budget on
  the first field. Both prompts now describe what a redaction is. **The mask itself is unchanged**
  and remains the boundary: every referenced secret is still redacted from every prompt input.
- The `--dry-run` ceiling now accounts for the re-judgment, as `N + R + min(N, R)` per step rather
  than `N + R`. A failing assertion costs three model calls where it used to cost two, and an
  estimate that undershoots is worse than none, because a budget gets sized from it.

### Added
- The demo app gains a support-ticket flow that answers a form POST with real server latency before
  redirecting, and a test covering it. Our previous flows redirected via `window.location.href` after
  a synchronous check — settling in microseconds — which is why twenty clean dogfood runs measuring
  the earlier flake fix were honest and unrepresentative at the same time. This class of defect is
  now reproducible in our own dogfooding instead of requiring someone else's application.

## [0.4.0] — 2026-07-30

### Fixed
- **`browser.timeout_ms` now governs resolving an element, and navigation — not only the
  action performed afterwards. This is a behavioural change for anyone who already set
  `timeout_ms`, not a quiet bugfix.** `resolveTarget`'s wait for a candidate element to
  become visible was hardcoded at two seconds, and `navigate` at thirty, regardless of
  configuration: Playwright lets an explicit per-call timeout win over
  `page.setDefaultTimeout(config.browser.timeout_ms)`, so the configured value reached only
  `click`/`fill`/`press`/`select`, never the resolution or the navigation before them. An
  application that hydrates a button in three seconds burned the self-healing retry budget
  on a slow paint instead of a defect, and raising `timeout_ms` — the obvious remedy —
  changed nothing. If your config already sets `timeout_ms`, resolution and navigation now
  wait up to that value where they previously waited two seconds and thirty seconds
  respectively; a genuinely missing element takes longer to fail as a result, which is the
  right trade (a false failure is worse than a slow one). Raising the timeout does not
  change the number of self-healing retries a step gets — waiting and retrying stay
  separate budgets. This covers the login journey (`auth.steps`) and `plan`'s initial route
  load too, not only `run`'s tests: a slow-hydrating login page used to fail authentication
  outright, which aborts the whole run, not one test.

### Added
- **The accessibility snapshot cap is configurable.** `browser.max_snapshot_lines` raises
  (or lowers) how many lines of the page's accessibility tree reach the model per
  snapshot, previously a fixed 200. Unset, behaviour is unchanged; truncation always stays
  visibly marked in the snapshot at whatever cap applies.
- **Preflight: every unmet prerequisite is reported together, before anything is spent on.**
  `run`, `plan` and `test` now verify — in one pass, not one crash per invocation — that the
  browser can launch, that the configured model provider is reachable, and that `base_url`
  responds. Each check is shallow (a connection attempt, never a credential check or a model
  call), so a false failure never costs more than the raw dump it replaces. Checks are selected
  by what the command is about to spend: `--dry-run` needs none of them and stays fully keyless
  and browserless. When the browser check succeeds, the launched instance is reused for the run
  itself rather than launched twice. Silent when every prerequisite is met.
- **A failed browser launch now explains itself.** `chromium.launch()` failures at the two launch
  sites (`run`, `plan`) used to surface Playwright's raw exception — about forty lines, including
  the full Chrome command line printed twice, with the one line that mattered (a missing shared
  library) buried behind roughly three hundred characters of `--disable-*` flags. Two causes are
  now recognised and given a plain remedy: a missing system library (names the library and the
  `install-deps` command, and notes that installing it needs elevated privileges) and a browser
  that was never installed (names the `playwright install` command). An unrecognised cause still
  surfaces the underlying error — never swallowed — but with the browser's command line stripped
  either way.
- **`plan --dry-run`.** Reports the routes a draft would be generated for, and those already
  covered, without launching a browser or calling the LLM — the same keyless, browserless answer
  `run --impacted --dry-run` already gives, for the one command documented for coverage gaps that
  previously could not answer without a provider key.
- **An unknown configuration key now warns instead of vanishing.** `.blastproof/config.yaml` was
  validated by a plain `z.object`, which discards a key it does not recognise with no error, no
  warning and no effect — including a whole unrecognised section such as a `budget:` block pasted
  into a version that predated the feature. Loading the config now names every such key (nested
  sections included) and warns that it has no effect; the run still proceeds, since a config
  written for a newer blastproof must still work on an older one.

## [0.3.0] — 2026-07-29

### Added
- **A run can now be bounded by a budget and a deadline.** Optional config section `budget:`
  (`max_llm_calls`, `max_tokens`, `max_duration_s`) plus matching flags `--max-llm-calls`,
  `--max-tokens`, `--max-duration`, and `BLASTPROOF_MAX_*` environment overrides (precedence
  flag > env > file, same as every other setting) — on `run`, `plan`, and `test` alike, since the
  spec counts "agent action, assert judgment, or test planning" against one budget and `plan` makes
  model calls too. Enforced at the single choke point every model call already passes through
  (`createBrain`/`createPlanner`), so it is total by construction — agent actions, assert judgments
  and the planner are all counted. `test` composes `run` then `plan`; the two phases share one budget
  instance rather than each resolving its own, so the pipeline stays bounded by the configured
  maximum instead of up to double it. Exhausting it stops the run and reports it as **incomplete**:
  unexecuted tests are a new `not-run` state, excluded from the score entirely rather than counted as
  failures, and the process exits 1 unconditionally, even when the executed tests would satisfy
  `--min-score`. `run --dry-run` now also prints the worst-case model-call ceiling for the selection,
  labelled as a maximum, not a forecast: per step this is the iteration cap **plus** the configured
  `max_retries_per_step` (read from config, not assumed — it has no upper bound), because a malformed
  model response is retried without spending an iteration, so the two pools are independent and must
  be added rather than one doubled while the other is ignored; and it includes the login journey's
  steps when `auth.steps` is configured, since authentication spends model calls through the same loop
  before any test runs. Absent config and flags, nothing binds and behaviour is unchanged — motivated
  by measuring #15's flake rate exhausting a provider's credit mid-sequence with no partial accounting
  and no warning.

### Fixed
- A step whose `assert` judgment passed did not end the step: the executor recorded the pass and
  looped for another action, and `fail` was still legal on that extra turn — so the model could, and
  measurably did, fail a step it had just proved succeeded. A passing assertion now terminates the
  step immediately, exactly as `done` does; the failing-assertion path (retry within budget, then
  fail) is unchanged. Measured over twenty dogfood runs against an unchanged tree and app: **15%
  before the fix (3/20, one hole across five tests), 0% after (0/20)**. Under the old rate, twenty
  consecutive clean runs would occur about 3.9% of the time. The fix also removes the redundant turn
  each step spent after its assertion, so runs make fewer model calls than before.

## [0.2.2] — 2026-07-28

### Security
- **The mask now covers the whole run, and every command.** It was built per test from that test's
  own steps, so the credential typed at login was invisible to every test that followed — an
  authenticated page echoing it fed it straight to the model. `plan` had no masking at all, on a path
  that authenticates and then browses the session. And matching was literal, while `navigate` reports
  a percent-encoded URL, so a secret containing a space passed through untouched.
- **Secrets could still reach the model.** `select` and `navigate` embed their resolved value in
  the result string, which was fed back into the next prompt as `lastResult` unmasked — so the
  0.2.0 guarantee held only for `fill`, the one action the regression test happened to cover.
  Everything crossing into a prompt is now masked at a single choke point, including the page
  snapshot, which can itself render a credential.

### Fixed
- `--fail-on-unmapped` silently did nothing without `--impacted`, since nothing is classified
  without a diff. It is now a usage error.
- `run --dry-run` reported a clean plan while ignoring test files that failed to parse, blessing a
  suite that was about to fail. It now reports them and exits 1.
- The action passed `--write` to `run`, which has no such flag, turning a plausible input
  combination into a hard failure.
- `run --dry-run --fail-on-unmapped` printed the unclassified files and exited 0 — a false green in
  the keyless, browserless pre-flight most likely to be trusted in CI.

### Documentation
- Removed a stale "known limitation" claiming `plan` cannot reach pages behind a login. It has used
  the `auth` recipe since 0.2.0.

## [0.2.1] — 2026-07-28

### Fixed
- `init` no longer scaffolds a runnable login test written for another application. It ships as
  `login.yaml.example`, inert until renamed, and uses `{{env.*}}` placeholders instead of literal
  credentials — a scaffolded test that assumed someone else's login failed on a newcomer's very
  first run.
- The repository's own config pointed at a GitHub organisation that does not exist. The generator
  was fixed in 0.1.2; the checked-in copy was not.

### Documentation
- The quick start now says to start your app and point `base_url` at it, which it previously assumed.
- The demo-app walkthrough now begins with a clone: `examples/` is not part of the npm package.

## [0.2.0] — 2026-07-27

Minor rather than patch: two changes alter existing behaviour.

### Security
- **The agent can no longer navigate outside the application under test.** An absolute URL previously
  ignored `base_url` entirely, so a page able to influence its own accessible text could send an agent
  holding a live session anywhere. Declare `allowed_origins:` for apps that legitimately span hosts.
  Enforced by comparison, not by prompt wording.
- **Secrets no longer reach the model.** `{{env.*}}` placeholders survive into the action and are
  substituted at the moment of typing, so a credential never enters a prompt — which matters because
  `llm.base_url` may point at a gateway you do not run.
- The system prompt now frames page content as data under test rather than instruction. This raises
  the cost of a casual injection and is explicitly **not** a security boundary.

### Fixed
- **BREAKING:** `llm.base_url` is now honoured for `provider: anthropic`. Traffic that silently reached
  the public API now goes to the configured endpoint.
- Two failing tests sharing a summary no longer overwrite each other's screenshot.

## [0.1.2] — 2026-07-27

### Added
- A consumable GitHub Action at the repository root, with a `score` output and a guard that rejects a
  shallow checkout before installing anything.

### Fixed
- The agent reported an already-satisfied step as a failure, reading "already done" as "impossible".

## [0.1.1] — 2026-07-27

### Fixed
- The CLI reported `0.0.1` regardless of the published version. It is now injected from the manifest
  at build time, and the release workflow verifies what the built binary reports.

## [0.1.0] — 2026-07-27

First public release: `init`, `run` (with `--impacted`), `plan` and `test`; authentication, JUnit and
HTML reports, a priority-weighted score with `--min-score`, and `--fail-on-unmapped`.
