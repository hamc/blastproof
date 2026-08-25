# Tasks: agent-skill-install

## 1. Measure what the skill will promise

- [x] 1.1 Run `blastproof plan --route /` against `examples/demo-app` and record the draft, unedited, in this change's notes — the skill's value rests on drafts being worth curating (design risk 2)
- [x] 1.2 Repeat with `--write`, then judge each draft by the criterion a human applies: **does every step name a control and an outcome that exist on the page?** Not "how many pass unedited" — the drafts measured here passed unedited and two of them were worthless, because the model that wrote the assertion is the one that judged it
- [x] 1.3 If drafts are not worth curating, stop and reopen the design. **Outcome: they are worth curating, but only because step 6 exists.** Folded into design risk 2

## 2. Skill skeleton

- [x] 2.1 `skills/blastproof/SKILL.md` — front matter: `name: blastproof`, `license: MIT`, and a `description` naming this tool and this task (`blastproof`, `.blastproof/`, plain-English YAML e2e tests, `plan`, `run`, "set up e2e tests"), without padding (design D7)
- [x] 2.2 `SKILL.md` — operating rules, before the workflow: generate from the running app never from source (D3); never commit (D4); never configure auth or CI (D9); mask nothing into logs, credentials come from `{{env.*}}`
- [x] 2.3 `SKILL.md` — pointers to `references/authoring.md` and `references/cli.md`, with one line each on when to read them

## 3. Workflow, in order

- [x] 3.1 Step 1 — fit, free pass: source scan for canvas or iframe on a primary flow, click handlers on non-interactive elements, unlabelled inputs. No config, no browser, no key. Structural shapes stop here, before anything is written (D2)
- [x] 3.2 Step 2 — provider: reuse `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` when set; otherwise offer a hosted key or Ollama with the unmeasured-quality caveat stated (D5)
- [x] 3.3 Step 3 — scaffold: `blastproof init`, then settle the three things it cannot detect — `base_url`, the provider chosen in step 2, and the example `routes:` globs, which belong to somebody else's project. Prove the wiring with `blastproof run --dry-run`. The `routes:` block goes with its key, since a keyless `routes:` fails validation, and route drift is not reported at all while nothing is declared — so the step must not promise a warning that cannot appear
- [x] 3.4 Step 4 — fit, confirming pass: `blastproof plan --route <route>` **without** `--write` against the running app. `plan` needs `.blastproof/config.yaml` and a provider, which is why this pass follows the scaffold rather than opening the workflow (D2)
- [x] 3.5 Step 4, repairable branch — report how many controls lack an accessible name, offer to add them, re-check after the repair; the misfit is the first task, not a rejection (D2)
- [x] 3.6 Step 4, structural branch — stop, say why, write no test file, state that `.blastproof/` can be deleted (D2)
- [x] 3.7 Step 4, login wall — a draft describing a sign-in page for a route that is not the login route means the route is behind auth. `plan` files a draft under the route requested, not the page reached, so this is a test that passes and covers nothing. Do not `--write`; hand it off instead (spec: login wall found)
- [x] 3.8 Step 5 — generate: `blastproof plan --route <route> --write`, **one route unless the person named more**. Curation is what runs out first, and the measurement in task 1 is the argument
- [x] 3.9 Step 6 — curate: edit each draft against `references/authoring.md`, run them, present files and result without committing (D4)
- [x] 3.10 Step 6, red run — name the three things a failure can be, and forbid the fourth: weakening the assertion. It is always cheapest and always available, and it turns a tool that found a defect into a suite reporting 100 over one
- [x] 3.11 Step 7 — contract: replace between the markers in the target file, or append; ask before touching a file the skill did not create (D6)
- [x] 3.12 Step 8 — mapping: `routes:` is a map keyed by file glob, stated before the edit rather than after; then run `--impacted --fail-on-unmapped --dry-run` to close the loop D10 argues for
- [x] 3.13 Step 9 — hand-off: routes behind a login, routes no test covers, auth and CI by URL

## 4. References

- [x] 4.1 `skills/blastproof/references/authoring.md` — quote the load-bearing rules from `plannerSystemPrompt` (`src/llm/prompts.ts`) **verbatim**, not paraphrased, so the copies stay comparable (design D8). Add around them what the prompt does not carry: the measured before/after (Score 64 → 100 from rewriting two steps)
- [x] 4.2 `references/authoring.md` — the YAML shape: `summary`, `priority`, `tags`, `routes`, `steps`, `auth: false`; English only, since the authoring check reads English only
- [x] 4.3 `skills/blastproof/references/cli.md` — `init`, `plan`, `run`, `test` with their flags and the exit codes 0/1/2
- [x] 4.4 `references/cli.md` — the two prerequisites that produce most first-run failures: `npx playwright install chromium`, and a key in the variable named by `api_key_env`
- [x] 4.5 `skills/blastproof/references/mapping.md` — what `routes:` and `ignore:` mean, that `ignore:` is for files with no user-visible effect, and that a path under a source directory entering `ignore:` needs a written reason in the pull request (D10)

## 5. Drift guard

- [x] 5.1 `tests/skill-manifest.test.ts` — extract from every fenced block and inline span under `skills/blastproof/**/*.md`, never from prose (design D8, mirroring `tests/action-manifest.test.ts`)
- [x] 5.2 Assert every `blastproof <command>` is a command the CLI has, and that the flags on that same line are ones **that command** declares — not the union, since `--tag` is real and still wrong on `plan`
- [x] 5.3 Assert `cli.md`'s per-command tables document no flag outside the command whose section they sit in
- [x] 5.4 Assert the rules quoted in `references/authoring.md` are **set-equal** to `plannerSystemPrompt()`'s, minus one planner-only rule excluded by name. Equality rather than containment: containment in either direction lets a rule be truncated to a prefix and pass, and keying on the prompt's bold markers lets a rule be un-bolded quietly out of coverage
- [x] 5.5 Assert both extractions found something, so a regex that stops matching cannot pass as a clean run
- [x] 5.6 Verify the test fails, seven ways, each naming what disagreed and where: unknown command and unknown flag **in a fenced block of `SKILL.md`**; a real flag on the wrong command; a flag renamed in `cli.md`; a canonical rule truncated to a prefix; a canonical rule dropped; a rule added to the prompt
- [x] 5.7 The first version of this guard read only inline code spans. Every command in `SKILL.md` is in a fenced block, so the file an agent executes from was entirely unchecked while the test stayed green — and the original four mutations all landed in `cli.md`, the one file where the guard worked. Mutate the file that matters, not the file that is easy

## 6. Repo surface

- [x] 6.1 `README.md` — install line `npx skills add hamc/blastproof` and a short section on the agent path, placed before the manual quick start
- [x] 6.2 `README.md` — state that the skill will not configure auth or CI, so the omission does not read as a defect
- [x] 6.3 `AGENTS.md` — record that `skills/` is user-facing content held to the same drift guard as `action.yml`

## 7. End-to-end check

- [x] 7.1 Follow the skill from a separate agent with no context, against a scratch copy of `examples/demo-app`, and record the wall-clock time from install to a passing test — **~119s**, with a key already set and Chromium already cached; the browser download is not in that number and dominates a cold machine
- [x] 7.2 Repeat the fit gate against a page with unlabelled controls and confirm the skill offers the repair, applies it, and then passes the re-check
- [x] 7.3 Repeat against a canvas-based page and confirm it stops before scaffolding, with evidence and no repair attempt
- [ ] 7.4 Change a file under `src/` with no `routes:` entry, run `--fail-on-unmapped`, and confirm the skill maps it rather than adding it to `ignore:` — **not exercised**; the adversarial pass covered fit, curation, idempotency and the CLI claims, and left the `ignore:` discipline (D10) untested
- [x] 7.5 Adversarial pass, agent with no context: eight findings — five fixed as reported, two corrected in a different direction, one escalated as a product defect. See `notes-plan-quality.md`
- [x] 7.6 Run the skill twice in the same project and confirm the accessibility block is updated, not duplicated

## 8. Verification

- [x] 8.1 `npm run build`
- [x] 8.2 `npm run typecheck`
- [x] 8.3 `npm test` — including the new `skill-manifest` test
