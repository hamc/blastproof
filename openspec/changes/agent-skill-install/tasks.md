# Tasks: agent-skill-install

## 1. Measure what the skill will promise

- [ ] 1.1 Run `blastproof plan --route /` against `examples/demo-app` and record the draft, unedited, in this change's notes — the skill's value rests on drafts being worth curating (design risk 2)
- [ ] 1.2 Repeat with `--write` and run the drafts; record how many pass unedited and what had to change to make the rest pass
- [ ] 1.3 If drafts are not worth curating, stop and reopen the design — the workflow in D3 depends on this and no wording fixes it

## 2. Skill skeleton

- [x] 2.1 `skills/blastproof/SKILL.md` — front matter: `name: blastproof`, `license: MIT`, and a `description` naming this tool and this task (`blastproof`, `.blastproof/`, plain-English YAML e2e tests, `plan`, `run`, "set up e2e tests"), without padding (design D7)
- [x] 2.2 `SKILL.md` — operating rules, before the workflow: generate from the running app never from source (D3); never commit (D4); never configure auth or CI (D9); mask nothing into logs, credentials come from `{{env.*}}`
- [x] 2.3 `SKILL.md` — pointers to `references/authoring.md` and `references/cli.md`, with one line each on when to read them

## 3. Workflow, in order

- [x] 3.1 Step 1 — fit, free pass: source scan for canvas or iframe on a primary flow, click handlers on non-interactive elements, unlabelled inputs. No config, no browser, no key. Structural shapes stop here, before anything is written (D2)
- [x] 3.2 Step 2 — provider: reuse `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` when set; otherwise offer a hosted key or Ollama with the unmeasured-quality caveat stated (D5)
- [x] 3.3 Step 3 — scaffold: `blastproof init`, then set `base_url` from the detected dev server; `blastproof run --dry-run` to prove the wiring without a browser or a key
- [x] 3.4 Step 4 — fit, confirming pass: `blastproof plan --route <route>` **without** `--write` against the running app. `plan` needs `.blastproof/config.yaml` and a provider, which is why this pass follows the scaffold rather than opening the workflow (D2)
- [x] 3.4a Step 4, repairable branch — report how many elements block resolution, offer to add accessible names, re-check after the repair; the misfit is the first task, not a rejection (D2)
- [x] 3.4b Step 4, structural branch — stop, say why, write no test file, state that `.blastproof/` can be deleted (D2)
- [x] 3.5 Step 5 — generate: `blastproof plan --route <route> --write` for the primary routes
- [x] 3.6 Step 6 — curate: edit each draft against `references/authoring.md`, run them, present files and result without committing (D4)
- [x] 3.7 Step 7 — contract: append the marked accessibility block to `AGENTS.md` or `CLAUDE.md`, asking before touching an existing file and updating in place on a second run (D6)
- [x] 3.8 Step 8 — mapping: seed `routes:` from the routes the drafts cover, and state the rule that it is updated in the same change as the code (D10)
- [x] 3.9 Step 9 — hand-off: name what was left out — auth behind a login (`docs/auth.md`), CI (`docs/ci.md`)

## 4. References

- [x] 4.1 `skills/blastproof/references/authoring.md` — quote the load-bearing rules from `plannerSystemPrompt` (`src/llm/prompts.ts`) **verbatim**, not paraphrased, so the copies stay comparable (design D8). Add around them what the prompt does not carry: the measured before/after (Score 64 → 100 from rewriting two steps)
- [x] 4.2 `references/authoring.md` — the YAML shape: `summary`, `priority`, `tags`, `routes`, `steps`, `auth: false`; English only, since the authoring check reads English only
- [x] 4.3 `skills/blastproof/references/cli.md` — `init`, `plan`, `run`, `test` with their flags and the exit codes 0/1/2
- [x] 4.4 `references/cli.md` — the two prerequisites that produce most first-run failures: `npx playwright install chromium`, and a key in the variable named by `api_key_env`
- [x] 4.5 `skills/blastproof/references/mapping.md` — what `routes:` and `ignore:` mean, that `ignore:` is for files with no user-visible effect, and that a path under a source directory entering `ignore:` needs a written reason in the pull request (D10)

## 5. Drift guard

- [x] 5.1 `tests/skill-manifest.test.ts` — extract every `blastproof <command>` and `--flag` named in `skills/blastproof/**/*.md`, assert each command exists and each flag appears in that command's `--help`, matching on a word boundary so `--min-scores` cannot pass as `--min-score` (design D8, mirroring `tests/action-manifest.test.ts`)
- [x] 5.1a Anchor the command pattern on backticked `` `blastproof <cmd>` ``, not bare prose. A first pass over the written skill matched `blastproof runs`, `blastproof reaches` and `blastproof repository` as commands — the loose-match failure #30 was fixed for
- [x] 5.2 Same test — extract the **bolded** rules from `plannerSystemPrompt()`, which is what the prompt marks as load-bearing and is exactly the set that is universal rather than planner-only and assert each appears verbatim in `references/authoring.md`, so a rule added to the prompt fails until the skill carries it (design D8)
- [x] 5.3 Same test, reverse direction — assert the skill quotes no canonical rule the prompt does not state, so it cannot teach a rule the tool does not enforce
- [x] 5.4 Assert both extractions found something, so a regex that stops matching cannot pass as a clean run
- [x] 5.5 Verify the test fails, four ways: rename a flag in `references/cli.md`; add a rule to the prompt; reword a quoted rule in the skill; invent a rule in the skill. Each failure must name what disagreed and the file that says it
- [x] 5.6 A fifth mutation, for the per-command check: document a real flag under the wrong command. The union check waves it through — `--tag` exists, just not on `plan` — so this is the assertion that earns its place

## 6. Repo surface

- [x] 6.1 `README.md` — install line `npx skills add hamc/blastproof` and a short section on the agent path, placed before the manual quick start
- [x] 6.2 `README.md` — state that the skill will not configure auth or CI, so the omission does not read as a defect
- [x] 6.3 `AGENTS.md` — record that `skills/` is user-facing content held to the same drift guard as `action.yml`

## 7. End-to-end check

- [ ] 7.1 Install the skill into a scratch copy of `examples/demo-app` with `npx skills add`, follow it from an agent, and record the wall-clock time from install to a passing test
- [ ] 7.2 Repeat the fit gate against a page with unlabelled controls and confirm the skill offers the repair, applies it, and then passes the re-check
- [ ] 7.2a Repeat against a canvas-based page and confirm it stops before scaffolding, with evidence and no repair attempt
- [ ] 7.2b Change a file under `src/` with no `routes:` entry, run `--fail-on-unmapped`, and confirm the skill maps it rather than adding it to `ignore:`
- [ ] 7.3 Run the skill twice in the same project and confirm the accessibility block is updated, not duplicated

## 8. Verification

- [ ] 8.1 `npm run build`
- [ ] 8.2 `npm run typecheck`
- [ ] 8.3 `npm test` — including the new `skill-manifest` test
