## 1. Reproduce the wrong PASS first

- [x] 1.1 Stand up Vikunja (`docker compose`, SQLite, one command) and configure blastproof against it, mirroring the evaluation that found this: a test that creates a project and verifies it appears in the projects list.
- [x] 1.2 **Confirm the wrong PASS against the application's database, not the tool's report.** `GET /api/v1/projects` must show the project absent while blastproof reports `Score: 100`. If it does not reproduce, say so plainly rather than adjusting the test until it does — a reproduction tuned to fail proves nothing, and a wrong PASS that will not reproduce changes what this change should be.
- [x] 1.3 Capture the exact log showing the substitution: the correct failure, then the unrelated claim that passed.
- [x] 1.4 Report before continuing. Do not write any fix in this group.

## 2. The judge decides the step

- [x] 2.1 `judge()` in `src/llm/brain.ts` takes the step alongside the expectation.
- [x] 2.2 `assertUserPrompt` in `src/llm/prompts.ts` presents the step as the question and the expectation as the claim offered in support; `assertSystemPrompt` states that a claim which is true but does not establish the step does not pass.
- [x] 2.3 Both call sites in `src/runner/executor.ts` — including the re-observation from `trustworthy-verdicts` — pass the step.
- [x] 2.4 `src/auth.ts` passes the login journey as the step for the `auth.verify` judgment. Check explicitly that this does not make working auth recipes stricter in a way that breaks them (design risk).
- [x] 2.5 The mask still applies to everything crossing into the prompt, the step text included.

## 3. Entered is not committed

- [x] 3.1 Tell the judge that a value present in an uncommitted control does not satisfy a step describing an outcome — appears in a list, is saved, is confirmed. This is the confusion that let an unsubmitted dialog satisfy "visible in the projects list", observed twice.
- [x] 3.2 Keep it narrow: it must not become "anything I am unsure about fails", which would trade a wrong PASS for a wrong FAIL.

## 4. Tests

- [x] 4.1 A claim that is true of the page but does not establish the step fails — the substitution case, in unit form.
- [x] 4.2 A claim satisfied only by an uncommitted form value fails.
- [x] 4.3 A legitimate second attempt still passes once the step's outcome holds, so `trustworthy-verdicts`' re-observation is not undone.
- [x] 4.4 The judge receives the step at both call sites, and receives it masked.
- [x] 4.5 The expectation and the judge's reason are still recorded and reported.
- [x] 4.6 Every test above must fail against current code. Verify it and say which ones did.

## 5. Verification

- [x] 5.1 `npm run build`, typecheck and the full vitest suite green.
  - 380 tests, build and typecheck clean.
- [x] 5.2 The group 1 reproduction now reports a verdict the database agrees with.
  - Satisfied in outcome rather than in letter, and worth stating plainly rather than reading the criterion to fit: I expected a FAIL. The reproduction now **passes**, and the project genuinely exists (`[Inbox, Eval Gamma Project, My Open Tasks]`). The stricter judge refused the unsubmitted dialog — *"the title field is empty and the Create button is disabled ... not the committed outcome"* — which forced the agent to finish the journey rather than accept it. A wrong PASS became a correct PASS.
- [x] 5.3 Dogfood: the demo suite still scores 100. A stricter judge that breaks working tests would be trading one defect for another.
  - 6/6, `Score: 100`. Nothing that worked broke, which was the main risk of this change.
- [x] 5.4 Re-run the wider evaluation suite against Vikunja and report which verdicts changed. Any test that flips from PASS to FAIL must be checked against the database before being called a fix — some may be correct failures the old judge was hiding.
  - 5 passed / 2 failed, every verdict checked against the API. The negative control still fails correctly, so the judge did not start rubber-stamping. The one unexpected failure is #28 rather than a judge defect: four duplicate tasks the tool created itself, correctly reported as still visible.
  - Two regressions surfaced here and only here, both invisible to a green unit suite — recorded as DEF-005, with the structural lever (`lastResult` never reaches the judge) noted and deliberately not taken until a third in that family appears.

## 6. Documentation

- [x] 6.1 CHANGELOG under Unreleased: the wrong PASS, that it was found by an outside evaluation against a real application's database, and that vague steps may now fail where they previously passed.
- [x] 6.2 README: steps that state their own outcome are now load-bearing, not just advisable.
- [x] 6.3 `AGENTS.md`: a judgment decides the step, not a claim about the page.
- [x] 6.4 Comment on #31 and #32 with the outcome; close them only once 5.2 and 5.4 hold.
