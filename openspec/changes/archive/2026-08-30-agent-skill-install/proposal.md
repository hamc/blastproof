# Proposal: agent-skill-install

## Why

#46 names the gap: of the three authors of a blastproof test — a human, the planner, and the user's coding agent — only the first two are ever told the rules, and the third is plausibly already the majority path.

Onboarding has the same shape. Install globally, run `init`, read an 80-line `config.yaml`, choose a provider, export a key, install Chromium, then write tests — most of it questions the developer answers by looking at their own project, which their coding agent already knows.

An agent skill moves both to whoever answers cheapest, and the distribution costs nothing: `npx skills add <owner>/<repo>` walks `skills/<name>/SKILL.md` in any public repository, needs no registration, and installs into the right directory for each of ~20 agents.

## What Changes

- Add `skills/blastproof/SKILL.md` — the workflow and the operating rules the agent follows
- Add `skills/blastproof/references/authoring.md` — the plain-English step rules, loaded on demand
- Add `skills/blastproof/references/cli.md` — commands, flags and exit codes
- Add `skills/blastproof/references/mapping.md` — what `routes:` and `ignore:` are for, and the bound on `ignore:`
- The skill's workflow: scan for fit → choose provider (including local Ollama) → `blastproof init` → confirm fit against the *running* app → generate drafts with `plan --route` → curate → `run` → seed `routes:` → record an accessibility contract in the project's agent instructions
- A misfit the agent can repair — controls with no accessible name — is offered as work and re-checked, rather than ending the install; only a structural one (canvas, iframe) stops it, and no test is written either way until fit holds
- Add a test asserting the skill names no flag the CLI lacks, and quotes the authoring rules verbatim from the planner prompt rather than becoming a third copy that drifts (#45)
- README: install line and a section on the agent path

## Capabilities

### New Capabilities

- `agent-skill`: the skill's contract — what it is allowed to write, the order it works in, and the boundaries it must not cross

## Impact

- New dependencies: **none**. `skills` is a tool the user runs, not a dependency
- Not shipped to npm: `files` is `["dist"]`, so `skills/` reaches users through the repository only
- Affects: new `skills/` tree, `README.md`, `AGENTS.md`, one new test
- No `src/` change
- Addresses #46. Bounds #45 without resolving it (D8). Does not address #72, which the skill's own workflow is exposed to

## Non-goals

- **No `blastproof init --agent` subcommand.** Fixing a sentence of guidance would then need a release, and it would reimplement the per-agent install paths the `skills` CLI already maintains
- **No separate skills repository.** The skill documents this CLI; splitting them guarantees drift. In-repo, one PR changes a flag and its documentation
- **No authentication setup.** The hardest configuration, and it would double the skill; it gets a pointer to `docs/auth.md`
- **No GitHub Action step.** CI is a second visit, after the user has seen a green run on their machine
- **No plugin manifest.** A plugin catalogue buys a slash command for one agent; the skill works on all of them
