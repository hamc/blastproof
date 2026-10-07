# Contributing to blastproof

Thanks for considering a contribution. Please read the first section before writing code — this repository works differently from most, and a patch that skips it cannot be merged as-is.

## Spec-driven development is required

**No code change lands without an approved change proposal.** Specifications are the source of truth; the code implements them. This repository uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) to keep the two in step.

For small, obvious fixes — a typo, a broken link, a wrong error message — open a pull request directly and say so. Judgment is welcome; the rule exists to keep behaviour and specification from drifting, not to add ceremony.

The cycle:

1. **Propose** — `openspec new change <kebab-name>`, then author `proposal.md` (why and what), `design.md` (how, with the alternatives you rejected and why) and `tasks.md` (checkboxes), plus spec deltas under `specs/<capability>/spec.md`
2. **Review** — a human reviews the proposal *before* implementation
3. **Apply** — implement the tasks, checking them off as you go
4. **Archive** — merge the deltas into `openspec/specs/` and move the change into `openspec/changes/archive/`

**Archive in the same pull request that implements the change**, as its own commit. OpenSpec offers both this and archiving as a follow-up after the merge, and asks you to pick one and be consistent; this is the pick. The follow-up convention exists so a branch visibly carries an in-flight change for the rest of a team, which buys nothing here and leaves `main` holding code its own specification does not describe until someone remembers. That gap is what this whole cycle exists to prevent, and it has already grown to four unarchived changes at once. A separate commit keeps the rename noise out of the diff you are reviewing the code in.

Validate at any point with `openspec validate <change-name> --strict`.

Specs use `SHALL` requirements, each with at least one `WHEN`/`THEN` scenario. Scenarios need exactly four hashtags (`#### Scenario:`) — three fails silently.

**Do not edit `CHANGELOG.md`.** It is written at release time by whoever cuts the release. Every pull request that touches it edits the same top section, so it conflicts with every other pull request that does — two open ones already did. Describe the change in the pull request instead; that is what the entry gets written from.

## Getting set up

```bash
npm install
npm run build         # tsup → dist/
npm test              # vitest
npm run typecheck     # tsc --noEmit
```

Node.js ≥ 20.19 (see `engines`). Use whichever version manager you like — none is pinned.

To exercise the CLI end to end, this repository ships a demo app:

```bash
node examples/demo-app/serve.mjs 4173 &
npx playwright install --with-deps chromium
export ANTHROPIC_API_KEY=...          # or configure another provider
node dist/cli.js run
```

Agentic runs cost tokens and need a real provider. Everything else — unit tests, `--dry-run`, `run --impacted --dry-run` — works with no key at all, so most contributions never need one.

### Changing how a verdict is reached

`evals/judge/` is a corpus of judge inputs with known correct verdicts, one file per incident that ever produced a wrong one: a wrong PASS, a wrong FAIL, or a verdict that flipped. If your change touches the judge (`judge()`, its prompt or its schema), replay it before opening the pull request:

```bash
EVAL_MODELS=anthropic/claude-haiku-4.5,openai/gpt-6-luna npm run eval:judge
```

Run it on both of those models. Each one goes through the provider your `.blastproof/config.yaml` and the usual `BLASTPROOF_*` overrides resolve, with only the model replaced, so a gateway such as OpenRouter serves both with one key. Without `EVAL_MODELS` it uses the configured model alone. The pair is deliberate. Haiku is the Anthropic default, so its verdicts are the ones an unconfigured user gets. Luna is another family. A judge fix written in prose and verified on one model may only fit that model's quirks; one that holds on both is less likely to.

It needs a model and a key, so it is not part of CI. It exits 1 when a case that used to be judged right is judged wrong in any sample on any model, and names the model. An answer that could not be used counts as a wrong sample, so one broken completion does not end the replay. A case marked `knownFailing` is a bug still open. When your change fixes one on every model, the run tells you, and you remove the marker in the same pull request; fixed on one model only, it stays marked. If you are fixing a new verdict incident, add its case to the corpus as part of the fix, captured from the run if you can, and say where it came from either way.

### Measuring how often a verdict is wrong

`evals/reliability/` runs the dogfood suite against the demo app as it is, and each targeted test against **mutants**: copies of the app with one declared bug seeded by exact text edits. A test that passes on a mutant is a false PASS; a test that fails on the unmodified app is a false FAIL. Run it before a release and before a change that claims to make verdicts more reliable:

```bash
npm run build
EVAL_MODELS=anthropic/claude-haiku-4.5,openai/gpt-6-luna npm run eval:reliability
```

It runs the built CLI, so build first. Models resolve as in `eval:judge`. `EVAL_SAMPLES` defaults to 5. `EVAL_MUTANTS=id,…` with `EVAL_SUITE=0` runs single mutants, for checking one you are writing. Logs, JUnit reports and `results.json` go under `.blastproof/reports/reliability-*/`. It needs a key and is not part of CI. A full run costs a few dollars on Haiku, cents on Luna.

A mutant lives in `evals/reliability/mutants.json`. Rules that keep the number honest:

- It breaks **only what its target's steps check**. A bug the steps cannot see measures the test's coverage, not the verdict.
- Each edit's `find` text occurs exactly once in the demo app. A unit test checks every mutant against the app as it is, so changing the demo app can fail CI. Update the mutant's text in the same pull request.
- `literal` mutants change the value a step quotes. Models catch those reliably. `subtle` mutants reproduce the shape of a past wrong verdict and name it in `incident`. A new verdict incident whose shape the demo app can show adds a subtle mutant, as it adds a judge-corpus case.
- A mutant that is caught every time stays. Removing the easy ones would bias the rate.

## Before you open a pull request

- `npm run build`, `npm test` and `npm run typecheck` all pass, and `npm run eval:judge` too if the change touches how a verdict is reached
- New behaviour is covered by tests; changed behaviour has its spec updated
- The change artifacts and the code agree — if implementation diverged from the design, update the design first and say why
- No secrets, and no `.env` (gitignored). `{{env.*}}` values are masked in all output; keep it that way

## Conventions

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) with a one-line subject — `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`, `refactor:`
- **No static selectors**, anywhere. Elements resolve live from the accessibility tree; a CSS selector or XPath in the runner or in a generated test is a bug, not a shortcut
- **Dependencies** need justification in the proposal. The tree is deliberately small
- **Output** stays machine-friendly: human tables on stdout, artifacts under `.blastproof/reports/`
- **Never log a secret.** Report generators escape everything they interpolate — summaries and failure reasons are model-authored and are not trusted to be markup-safe

`AGENTS.md` carries the architecture, the milestone plan and the full conventions. Read it before your first change.

## Releases

Publishing runs from a **tag**, never from a merge: the workflow refuses to publish if the tag and the manifest version disagree, rebuilds, re-runs the full verification, and publishes with npm provenance. So the package you install is built from a commit you can name.

Cutting one is a maintainer task and lives in [RELEASING.md](RELEASING.md). The only part that binds a pull request is the rule above: **do not edit `CHANGELOG.md`.**

## Finding something to work on

Open issues are the backlog. Each states a problem and why it matters, not a solution — deciding the solution is what a change proposal is for.

## Reporting bugs

Include the command you ran, the provider and model, what you expected, and what happened. A `--dry-run` output or a JUnit/HTML report is worth more than a description. Redact your keys — and note that a failure screenshot may contain application data you would rather not publish.

## Security

Found something exploitable? Please do not open a public issue. Report it privately through GitHub's security advisories on this repository.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
