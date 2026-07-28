# Contributing to blastproof

Thanks for considering a contribution. Please read the first section before writing code — this repository works differently from most, and a patch that skips it cannot be merged as-is.

## Spec-driven development is required

**No code change lands without an approved change proposal.** Specifications are the source of truth; the code implements them. This repository uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) to keep the two in step.

The cycle:

1. **Propose** — `openspec new change <kebab-name>`, then author `proposal.md` (why and what), `design.md` (how, with the alternatives you rejected and why) and `tasks.md` (checkboxes), plus spec deltas under `specs/<capability>/spec.md`
2. **Review** — a human reviews the proposal *before* implementation
3. **Apply** — implement the tasks, checking them off as you go
4. **Archive** — merge the deltas into `openspec/specs/` and move the change into `openspec/changes/archive/`

Validate at any point with `openspec validate <change-name> --strict`.

Specs use `SHALL` requirements, each with at least one `WHEN`/`THEN` scenario. Scenarios need exactly four hashtags (`#### Scenario:`) — three fails silently.

For small, obvious fixes — a typo, a broken link, a wrong error message — open a pull request directly and say so. Judgment is welcome; the rule exists to keep behaviour and specification from drifting, not to add ceremony.

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

## Before you open a pull request

- `npm run build`, `npm test` and `npm run typecheck` all pass
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

Publishing runs from a tag, never from a merge — a released version can never be edited and the package name is claimed permanently, so it takes a deliberate act:

```bash
# bump the version in package.json first, then
git tag v0.1.0 && git push origin v0.1.0
```

The release workflow refuses to publish if the tag and the manifest version disagree, rebuilds and re-runs the full verification, and publishes with npm provenance. It needs an `NPM_TOKEN` secret on the repository.

## Finding something to work on

Open issues are the backlog. Each states a problem and why it matters, not a solution — deciding the solution is what a change proposal is for.

## Reporting bugs

Include the command you ran, the provider and model, what you expected, and what happened. A `--dry-run` output or a JUnit/HTML report is worth more than a description. Redact your keys — and note that a failure screenshot may contain application data you would rather not publish.

## Security

Found something exploitable? Please do not open a public issue. Report it privately through GitHub's security advisories on this repository.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
