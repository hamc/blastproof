# Proposal: m4b-github-action

## Why

The package is published, but putting it in a pipeline still means writing the same twenty lines every time: install Node tooling, download Chromium, translate provider settings into environment variables, remember that `--impacted` needs a full clone. That boilerplate is where the mistakes live — a shallow checkout silently breaks impact analysis, and a misnamed key variable fails halfway through a run. An action carries that knowledge so the user does not have to.

## What Changes

- Add a composite action at the repository root, used as `uses: hamc/blastproof@<tag>`
- Inputs for the run (`command`, `base`, `min-score`, `url`, `junit`, `html`, `fail-on-unmapped`, `write`) and for the provider (`api-key`, `provider`, `model`, `llm-base-url`), mapped onto the `BLASTPROOF_*` overrides
- `api-key` accepts the secret directly and is bridged onto the existing `api_key_env` indirection, so nothing about the CLI's key handling changes
- Guard: fail with an actionable message when the checkout is shallow and the chosen command needs a merge-base
- Output `score`, read from the JUnit report the action always writes, so a following step can use it without scraping logs
- README section showing the minimal workflow and a gated one

## Capabilities

### New Capabilities

- `github-action`: the action's interface — inputs, outputs, the checkout guard and how provider settings reach the CLI

## Impact

- New dependencies: **none**; the action installs the published npm package
- Affects: new `action.yml`, README, `AGENTS.md`, and a self-test workflow
- Completes milestone M4

## Non-goals

- No PR comments: posting results needs write permissions on pull requests and a comment-update strategy of its own, and it is listed post-MVP
- No GitLab or CircleCI equivalents
- No moving `v1` tag: the project is 0.x and a floating major would promise a stability that does not exist yet
- No bundled Node setup: GitHub runners already ship a supported Node, and a second setup step would only add surprises
