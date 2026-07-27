# Design: m4b-github-action

## Context

`blastproof` is on npm and the CLI already accepts everything a pipeline needs: provider settings from `BLASTPROOF_*` variables, `--min-score` for gating, `--junit` for machine-readable output, `--fail-on-unmapped` for coverage classification. What is missing is the packaging of that knowledge. The dogfood workflow in this repository is the honest measure: it is forty lines, and most of them are things every consumer would have to rediscover.

## Goals / Non-Goals

**Goals:** a short workflow snippet that works, provider configuration without touching a config file, a usable `score` output, and failure messages that name the fix.

**Non-Goals:** PR comments, other CI providers, a floating major tag, bundled Node setup.

## Decisions

### D1: A composite action, not a container or JavaScript action
The work is "install a CLI and run it", which composite steps express directly. A Docker action would pay minutes per run to build or pull an image for a package that installs in seconds. A JavaScript action would mean a second build artifact to keep in sync with the CLI it wraps, for no behaviour the shell cannot express.

### D2: `api-key` is bridged onto the existing `api_key_env` indirection
Users expect `api-key: ${{ secrets.ANTHROPIC_API_KEY }}` — the shape every action uses. The CLI deliberately never reads a key from a blastproof-prefixed variable; its config names *which* variable holds it (config-env-overrides D6). The action reconciles these: it places the input in one fixed variable and sets `BLASTPROOF_LLM_API_KEY_ENV` to that variable's name. The familiar interface is preserved and the CLI's rule is untouched — the indirection is what makes this a two-line bridge instead of a change to key handling.

### D3: The shallow-checkout guard fails early and says what to do
`actions/checkout` is shallow by default, and `--impacted` needs a merge-base; without one the run exits 2 partway through with a git error. That was proven the hard way when validating the CI cycle. The action checks `git rev-parse --is-shallow-repository` before doing anything and, for commands that diff, fails immediately telling the user to set `fetch-depth: 0`. A guard that names the fix is worth more than an accurate error thirty seconds later.

### D4: `score` is read from JUnit, not from stdout
The action always writes a JUnit report — to the user's path when given, otherwise to a temporary one — and reads the score from its `<property name="score">`. Parsing console output would couple the action to a human-facing format that is free to change; the JUnit property exists precisely so a machine can read the score, and this is that machine. The output is empty when no report was produced, rather than a fabricated zero, so a consumer can tell "no score" from "scored zero".

### D5: No `v1` tag while the project is 0.x
Action convention is a floating major tag, but publishing `v1` from a 0.1.x project would promise a stability that does not exist and that the version number explicitly denies. Users pin the release tag, which is also what GitHub's own hardening guidance recommends. A moving major becomes honest at 1.0.

### D6: The `version` input defaults to `latest`, and pinning is documented
The action cannot reliably discover the release it was checked out at, and hardcoding a version at release time creates a second thing to keep in step. `latest` is the useful default for getting started; the README shows pinning both the action tag and `version` for a reproducible pipeline, and says why that matters for a tool that gates merges.

### D7: Node is assumed, Chromium is installed
GitHub runners ship a supported Node, so a bundled `setup-node` would add a step, a cache and a class of version surprises for nothing. Chromium is different: it is never present, the CLI cannot work without it, and `--with-deps` needs the system libraries too. The action installs it, with an input to skip when a workflow already did.

## Risks / Trade-offs

- `latest` means a pipeline can change behaviour without the user changing anything → Mitigation: documented, with pinning shown for anyone gating merges on the result.
- The action's inputs become a compatibility surface the moment anyone adopts it → Accepted, and the reason the names mirror the CLI flags exactly rather than inventing a second vocabulary.
- Chromium installation dominates the runtime of a small run → Accepted; `install-browser: false` exists for workflows that cache or pre-install it.
- A composite action's failure messages are shell output, with no structured annotations → Mitigation: the guard uses `::error::` so it surfaces in the run summary.

## Migration Plan

Purely additive: a new file at the repository root and documentation. Nothing existing changes, and the dogfood workflow keeps running the CLI directly, which keeps exercising the path the action wraps.

## Open Questions

(none)
