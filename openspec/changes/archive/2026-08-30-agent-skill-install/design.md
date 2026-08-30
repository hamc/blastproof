# Design: agent-skill-install

## Context

A skill is a directory an agent reads before acting: `SKILL.md` carries a `name` and a `description` that decide when it triggers, plus the procedure; `references/` holds detail the agent loads only when it needs it. The `skills` CLI (`vercel-labs/skills`, MIT) installs any public repository laid out as `skills/<name>/SKILL.md`, resolving the destination per agent — `.claude/skills/` for Claude Code, `.agents/skills/` for Cursor and Codex, and so on. No registration, no publishing step, no account.

Everything the workflow needs already exists in the CLI. `init` scaffolds, `plan --route <r>` bypasses the diff and generates a draft from a route, `--write` persists it, `run --dry-run` validates the setup without a browser or a key. This change adds no machinery; it writes down an order of operations and the two or three rules that decide whether the result is worth anything.

## Goals / Non-Goals

**Goals:**
- One command plus one sentence, from nothing to a passing test
- Establish early and cheaply whether the application can be tested this way, and repair the obstacle when it is repairable
- Make the local-model path visible without overstating it
- Leave the project able to stay testable after the skill has run
- Keep the skill honest about what it is allowed to change

**Non-Goals:** authentication, CI wiring, a plugin manifest, a CLI subcommand, non-English test authoring.

## Decisions

### D1: The skill lives in this repository, under `skills/blastproof/`
The skill's whole content is claims about this CLI — flag names, exit codes, the shape of `config.yaml`. Kept in a second repository those claims drift silently, and the drift is invisible precisely because a skill is read by a machine that will not notice a flag was renamed. In-repo, the PR that renames a flag can fix the sentence that names it, and a test can fail when it does not (D8).

A `blastproof init --agent` subcommand was rejected for the same reason inverted: it would put guidance behind a release cycle, and it would have to carry a table of per-agent install directories that changes whenever a new agent appears — a table the `skills` CLI already maintains for about twenty of them. `package.json` restricts `files` to `["dist"]`, so nothing here reaches the npm tarball.

### D2: Fit is established before any test is written, and a fixable misfit is offered as work rather than treated as a rejection
blastproof resolves elements from the accessibility tree with no fallback, so an application whose controls carry no accessible name cannot be tested by it. That is established in two passes, and the passes cannot both come first:

1. **A source scan**, before anything is configured — click handlers on non-interactive elements, inputs with no label, a canvas or an iframe carrying a primary flow. Free, needs no config, no browser and no key, and it is the pass that catches the fatal cases.
2. **`blastproof plan --route <main route>` without `--write`**, against the running app. The printed draft is the evidence: a page whose accessibility tree says nothing produces a draft that says nothing.

Pass 2 cannot precede scaffolding, because `plan` refuses to run without `.blastproof/config.yaml` and it makes a model call, which needs the provider already chosen. So the boundary is not *before configuration* — it is **before any test is written**. Scaffolding is cheap, reversible and creates no obligation; a suite of generated tests against an application that cannot be tested is the thing that must never exist. When pass 2 ends in a structural misfit the skill says so and says that `.blastproof/` can be deleted.

What happens next depends on which kind of misfit it is, and this is the decision that matters. Outside an agent, both kinds end the same way — the tool does not fit, the user leaves. Inside one they are not the same at all:

- **Repairable** — unlabelled buttons, inputs without labels, a `div` carrying a click handler. The remedy is an accessible name, which is a small, safe, local edit the agent can make. The skill reports how many elements block it and offers to fix them, then re-checks. A misfit here is the first task, not a rejection.
- **Structural** — a primary flow drawn on a canvas, or shipped inside an iframe. No amount of labelling reaches it, and offering to try would be dishonest. The skill stops, says why, and says that the scaffold can be removed.

Treating every misfit as a rejection was rejected because it throws away the whole reason this change exists: the agent is standing right there and can remove the obstacle. Treating every misfit as repairable was rejected for the opposite reason — a canvas cannot be made accessible by editing markup, and an agent that tries will churn, spend the user's key, and end where it started.

Configuring first and letting the first run fail was rejected in both cases. The failure surfaces as red tests, which reads as "the tool is broken" rather than "this application is not reachable this way", and it spends the user's key to deliver that message.

### D3: Drafts are generated from the running application, never authored from source
The skill starts the dev server and generates with `plan --route`. It is forbidden from writing a test file by reading components.

This is the decision the whole change exists to enforce. An agent that authors both the implementation and the test from one reading of the source produces a test that shares the implementation's misconceptions and passes for that reason — which is the failure blastproof exists to catch, reintroduced by its own installer. `plan` reads a rendered accessibility tree, which is the one input in the loop that the agent did not write.

### D4: The agent curates the draft; the human still gates the commit
`plan --write` persists drafts, the agent edits them against the rules in `references/authoring.md`, runs them, and presents the result. It does not commit. The README's boundary — everything below the line is run by choice and reviewed before it lands — is preserved, with the agent taking the first pass rather than replacing the reader.

### D5: Provider choice is asked, not assumed, and the local path is stated without being sold
The skill reads the environment: a key already present is used. With none, it offers a key or Ollama, and describes Ollama accurately — no cost, nothing leaving the machine, and *quality against this workload has not been measured*. Presenting an unmeasured path as equivalent would turn the project's strongest structural difference into its most common reason for abandonment, discovered by the user on their first run.

### D6: The skill records an accessibility contract in the project's agent instructions
Configuring a suite fixes today. The project keeps being built by an agent, so without a written constraint the next twenty screens arrive as unlabelled `div`s and the suite decays into red. The skill appends a short contract — every interactive element carries an accessible name, forms have labels, no `div` as a button, no canvas on a primary flow — to `AGENTS.md`, or to `CLAUDE.md` when that is what the project uses.

Two limits, because this is the skill writing to a file it does not own: it asks before modifying an existing file, and it is idempotent — a marker comment means a second run updates in place instead of appending again.

### D7: `SKILL.md` stays short; the detail lives in `references/`
`SKILL.md` holds the trigger, the operating rules and the ordered workflow. Three references carry the rest: `authoring.md` (how a step must be written, and why a bare action is worthless), `cli.md` (commands, flags, exit codes) and `mapping.md` (what `routes:` and `ignore:` are for). A single large skill file was rejected because it is loaded into context on every turn that matches its description, including the many that need only one line of it.

The `description` gets the triggers that actually name this tool and the task — `blastproof`, `.blastproof/`, plain-English YAML e2e tests, `plan`/`run`, "set up e2e tests". Padding it with every conceivable phrasing raises false triggers on unrelated work, which costs the user context on every turn and teaches them to uninstall it.

### D8: A test keeps the skill from drifting, on both kinds of claim it makes
The skill makes two kinds of claim, and both can go stale without anyone noticing, because the reader is a machine that will not report a contradiction.

**The CLI's surface.** `tests/action-manifest.test.ts` already asserts that every flag `action.yml` sends is a flag the CLI declares. The skill is the same class of artifact — a file outside `src/` describing that surface — so it gets the same guard: in every fenced block and inline span under `skills/` — never in prose — a `blastproof <command>` must be a command the CLI has, and the flags on that line must be ones that command declares.

**The authoring rules.** These already exist in two hand-maintained copies (`plannerSystemPrompt` in `src/llm/prompts.ts` and the README's *Writing tests*), they have drifted once, and nothing fails when they disagree. A third copy written freehand would make that worse, and it is the copy that reaches the agents writing most of the tests.

So the skill does not paraphrase the rules — it copies the prompt's rule lines whole, and the test asserts the two sets are **equal**, one named planner-only rule aside. Set equality rather than containment is deliberate: a containment check in either direction lets a rule be truncated to a prefix and still pass, and a check keyed on the prompt's bold markers lets a rule be un-bolded quietly out of coverage. Equality has neither hole, and it fails on a rule added to the prompt, dropped from the skill, or reworded on either side.

Quoting rather than restating was chosen over prose written for the agent's benefit. The README already restates them in a human's words and that is right for a human; an agent gains nothing from a second phrasing and loses the one property that makes the copy checkable.

This does not resolve the underlying duplication — the rules still live in two places by hand, and collapsing them to one source is a change to `src/` that belongs in its own proposal. It bounds the damage: the copies may still be worded differently, but they can no longer say different things without a test failing.

### D9: Authentication and CI are deliberately absent from v1
An application behind a login is the point where this stops being one sentence: the skill would have to choose among three strategies, handle credentials, and explain why a login test needs `auth: false`. It instead detects a login wall, says that routes behind it are out of reach for now, and points at `docs/auth.md`. CI is left out on sequencing — a workflow file added before the user has seen a green run locally is a second thing to debug at the moment they have the least reason to trust the first.

### D10: The skill states what `ignore:` is for, because the cheapest way to satisfy `--fail-on-unmapped` is to abuse it
`--fail-on-unmapped` fails a run when a changed file matches neither a `routes:` glob nor an `ignore:` one. In an agent loop that check is self-healing in the good sense: the agent changes a file, the check goes red, the agent classifies the file, and the mapping stays current instead of rotting the way a hand-maintained one does. That is a real argument for this change.

It is also a check with a back door. Putting the file under `routes:` requires knowing which pages it can break. Putting it under `ignore:` is one line, works every time, and silences the check permanently. An agent optimising for green will take the second, and this is the same failure as an agent editing a test until it passes, moved one level up: the check that exists to force classification ends up satisfied by the classification that means *do not look at this*.

So the skill carries the rule the config file cannot enforce. `ignore:` is for files with no user-visible effect — documentation, licences, CI configuration. A file under `src/` entering `ignore:` requires a written reason in the pull request, and the skill says so rather than leaving it to be inferred.

The second half is ordering. The mapping is written in the same change as the code, not as a repair after a red check. The blast radius is knowledge the agent has while it is making the change and has largely lost by the time it is looking at a failing check in isolation — at which point it guesses, and `ignore:` is the guess that always works.

Enforcing this in the runner — warning when `ignore:` gains a path under a source directory — was considered and left out. It is a change to `src/` in a content-only slice, and it deserves its own proposal with its own thought about false positives.

## Rejected alternatives

- **A `blastproof init --agent` subcommand** — puts guidance behind a release cycle and duplicates a per-agent install table the `skills` CLI already maintains (D1)
- **A separate skills repository** — guarantees silent drift from the CLI it documents (D1)
- **Stopping on every misfit** — throws away the agent standing right there who can add the accessible names (D2)
- **Offering a repair for every misfit** — a canvas cannot be labelled into reachability, and trying spends the user's key to arrive where it started (D2)
- **Configuring first, letting the first run fail** — surfaces as red tests, which reads as a broken tool rather than an unreachable application (D2)
- **One large `SKILL.md`** — loaded on every turn its description matches, most of which need one line of it (D7)
- **A keyword-stuffed `description`** — buys triggering at the cost of firing on unrelated work, which teaches the user to uninstall it (D7)
- **Paraphrasing the authoring rules for the agent's benefit** — a paraphrase cannot be compared mechanically, which is the only property that keeps a third copy honest (D8)
- **Warning in the runner when `ignore:` gains a source path** — a change to `src/` inside a content-only slice; needs its own proposal and its own thought about false positives (D10)

## Risks / Trade-offs

- **The skill is prose, and prose about a moving CLI rots.** D8 covers the flags and the authoring rules, which are the claims that break loudly. Wording around them — the workflow's ordering, the fit heuristics, what the skill says about providers — is not covered and needs a human reading it at release time.
- **`plan` quality decides whether the install delights or disappoints.** Measured (task 1, `notes-plan-quality.md`): drafts are worth curating, but only because step 6 exists. Of three drafts, one was truncated mid-sentence, asserted nothing, ran unedited and scored 100; another asserted a cart total on a cart nothing had been added to. Both passed. The risk is therefore not that drafts are useless — it is that they are plausible, and that the run's own verdict cannot tell you which kind you have.
- **A second agent-facing instruction file in user projects.** D6 writes into `AGENTS.md`, which the project may already be using heavily. Appending a marked block, asking first, and keeping it to four lines is the mitigation.

## Migration Plan

Nothing to migrate. The change adds files and breaks no existing surface: `skills/` is new, `package.json` is untouched so the npm tarball is unchanged, and no `src/` behaviour moves. A user who never runs `skills add` sees only a new README section.

Rollback is deleting `skills/`, `tests/skill-manifest.test.ts` and the two documentation sections. The skill carries no state and installs into the user's project by copy or symlink, so an installed copy keeps working after a rollback here and is removed by the same tool that installed it.

## Open Questions

- **Does `plan` hold up outside a static demo app?** Every measurement so far is against `examples/demo-app`, which we wrote and made accessible. A framework app with a real login is the case that decides whether step 4's confirming pass is worth its model call.
- **Is the accessibility contract (D6) obeyed once written?** It is prevention with no detection behind it; only the suite going red weeks later would tell us, and nobody has watched that happen.
- **Does the `ignore:` discipline (D10) survive contact with an agent optimising for green?** Task 7.4 is unexercised — the reasoning is sound and the behaviour is unobserved.
- **Is quoting the right long-term answer to #45?** Generating the skill's rules from one source removes the copy instead of policing it. Left for that issue's own proposal.
