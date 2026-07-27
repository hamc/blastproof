# Tasks: m4b-github-action

## 1. The action

- [ ] 1.1 `action.yml` — name, description, branding, and the documented inputs and `score` output
- [ ] 1.2 Shallow-checkout guard, running before any install and emitting `::error::` naming `fetch-depth: 0` (design D3)
- [ ] 1.3 Install step: `npm install -g blastproof@<version>`, plus Chromium with `--with-deps` unless `install-browser` is false (design D7)
- [ ] 1.4 Run step: compose the CLI invocation from the inputs, exporting provider settings as `BLASTPROOF_*` and bridging `api-key` onto `api_key_env` (design D2)
- [ ] 1.5 Score step: always write a JUnit report, read `<property name="score">` from it, expose it as an output, empty when absent (design D4)

## 2. Verification

- [ ] 2.1 Action metadata parses and its inputs/outputs are what the spec describes
- [ ] 2.2 In the throwaway probe repository: the action runs green against the demo app, and the `score` output is readable by a following step
- [ ] 2.3 A shallow checkout fails with the guard's message, before installing anything

## 3. Docs

- [ ] 3.1 README: a minimal workflow, a merge-gating one, the full input table, and why pinning the tag and `version` matters when gating merges
- [ ] 3.2 `AGENTS.md`: mark M4 done and record that the action lives at the repository root
