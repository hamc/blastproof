## Why

A first-time-user trial installed from npm, read only the public documentation, and hit two walls before the tool did anything useful. Neither wall was a defect in what blastproof computes; both were failures to say what was wrong.

The larger one: when Chromium cannot start, `chromium.launch()` at `src/commands/run.ts:584` and `src/commands/plan.ts:210` is uncaught, so Playwright's raw exception reaches the user — roughly forty lines containing the full Chrome argv twice, with the one line that matters (`error while loading shared libraries: libnspr4.so`) buried mid-dump behind three hundred characters of `--disable-*` flags. The trial's verdict: *"this is where you conclude the tool is broken on your machine."* Every handled error in this project is exemplary; the one unhandled path is proportionally worse for it.

The second: prerequisites are discovered one crash at a time. The browser launches before the model is ever contacted, so a missing browser and an unreachable model are found in series, each costing a run. Nothing checks that `base_url` responds at all.

Two smaller findings share the shape. `configSchema` is a plain `z.object`, so Zod discards unknown keys silently — the trial pasted a `budget:` block into 0.2.2, which predated the feature, and got no error, no warning and no effect. And `plan` has no `--dry-run`, so the one command documented for coverage gaps is the only one that cannot answer without an API key, while `run --impacted --dry-run` prints the same uncovered routes for free.

## What Changes

- A failed browser launch reports what is missing and how to fix it, instead of a raw Playwright dump.
- A preflight check reports **all** unmet prerequisites at once — browser, model reachability, `base_url` responding — before any of them is spent on.
- Unknown keys in `.blastproof/config.yaml` produce a warning naming the key, rather than silence.
- `plan` accepts `--dry-run`, reporting the routes it would generate for without contacting a provider.

## Capabilities

### New Capabilities

- `preflight`: verifying prerequisites before a run and reporting every unmet one together, with actionable messages.

### Modified Capabilities

- `cli-plan-command`: gains `--dry-run`.

Unknown-key reporting belongs to `preflight` rather than to `config-overrides`: `config-overrides` describes how a setting's value is resolved across file, environment and flag, while this is about telling someone a setting they wrote is having no effect — the same job as every other check here, arriving at the same moment.

## Non-goals

- **Not** installing anything on the user's behalf. A tool that runs a package manager as root because a library was missing is a worse problem than the one it solves; preflight says what is wrong and stops.
- Not a `doctor` subcommand. The check belongs on the path people already take — a separate command only helps those who already suspect trouble. Reconsider if preflight grows beyond three checks.
- Not rejecting unknown config keys. A warning is right where a hard failure is not: a config written for a newer version should still run on an older one.
- Not the unsupported-interaction list (iframes, hover, upload). Documented in the README; each is its own capability.

## Impact

- `src/commands/{run,plan}.ts` — the two unguarded `chromium.launch` sites, and where preflight runs.
- `src/config.ts` — unknown-key detection during load.
- `src/cli.ts` — `plan --dry-run`.
- A new preflight module, plus its error shapes.
- No new npm dependency: Playwright reports the failure, the provider client reports reachability, and `fetch` covers `base_url`.
