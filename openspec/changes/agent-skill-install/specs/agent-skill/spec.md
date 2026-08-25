# Spec: agent-skill

## ADDED Requirements

### Requirement: Installable skill layout
The repository SHALL contain `skills/blastproof/SKILL.md` with `name` and `description` front matter, so that `npx skills add <owner>/<repo>` installs it without any registration or publishing step.

#### Scenario: Installed by the skills CLI
- **WHEN** a developer runs `npx skills add hamc/blastproof` in a project
- **THEN** the skill is written to the directory their agent reads, for each agent the CLI detects

#### Scenario: Not shipped to npm
- **WHEN** the package is published
- **THEN** the tarball contains `dist` only, and no `skills/` directory

#### Scenario: Detail is loaded on demand
- **WHEN** the agent needs the authoring rules or the flag list
- **THEN** it reads `references/authoring.md` or `references/cli.md`, which `SKILL.md` names rather than inlines

### Requirement: Fit is established before any test is written, and a repairable misfit is offered as work
The skill SHALL determine whether the application is reachable through the accessibility tree before it writes any test file. When the obstacle is repairable it SHALL offer to repair it and re-check; when it is structural it SHALL stop with an explanation.

#### Scenario: Fatal shapes are caught before anything is configured
- **WHEN** the skill starts
- **THEN** it scans the source for a canvas or iframe on a primary flow, for click handlers on non-interactive elements and for unlabelled inputs, without a config file, a browser or a key

#### Scenario: Evidence comes from the running application
- **WHEN** the skill confirms fit after scaffolding
- **THEN** it runs `blastproof plan --route <route>` without `--write` against the running app and treats the printed draft as the evidence

#### Scenario: Repairable misfit
- **WHEN** controls carry no accessible name, inputs have no label, or a `div` carries a click handler
- **THEN** the skill reports how many elements block it, offers to add accessible names, and re-checks fit after the repair

#### Scenario: Structural misfit
- **WHEN** a primary flow is drawn on a canvas or lives inside an iframe
- **THEN** the skill reports that blastproof cannot reach it, does not offer a repair, writes no test file, and states that `.blastproof/` can be deleted

#### Scenario: Fit is confirmed
- **WHEN** the accessibility tree exposes the primary flow
- **THEN** the skill proceeds to provider choice and scaffolding

### Requirement: Drafts are generated from the running application
The skill SHALL generate test drafts with `blastproof plan`, and SHALL NOT author a test file from reading source code.

#### Scenario: Drafts generated from a route
- **WHEN** the skill creates the first tests
- **THEN** it starts the application and runs `blastproof plan --route <route> --write`

#### Scenario: Authoring from source is refused
- **WHEN** the application cannot be started
- **THEN** the skill reports that it cannot generate tests yet, and does not write test files inferred from components

### Requirement: The human gates the commit
The skill SHALL present the generated tests and the run result for review, and SHALL NOT commit them.

#### Scenario: Drafts curated then shown
- **WHEN** drafts have been written and edited against the authoring rules
- **THEN** the skill runs them and presents the files and the result, leaving the commit to the developer

### Requirement: Provider choice includes a local path, described accurately
The skill SHALL use a provider key already present in the environment, and otherwise SHALL offer both a hosted key and Ollama, stating that quality with a local model has not been measured against this workload.

#### Scenario: Existing key reused
- **WHEN** `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set
- **THEN** the skill configures that provider without asking

#### Scenario: No key present
- **WHEN** neither variable is set
- **THEN** the skill offers a hosted key or Ollama, noting for Ollama that no cost is incurred, that nothing leaves the machine, and that its quality here is unmeasured

### Requirement: An accessibility contract is recorded in the project
The skill SHALL record, in the project's agent instructions file, the constraints that keep the application testable, and SHALL do so without destroying content it does not own.

#### Scenario: Contract added
- **WHEN** the skill finishes configuring a project
- **THEN** it appends a marked block to `AGENTS.md`, or to `CLAUDE.md` when the project uses that file, requiring accessible names on interactive elements, labelled form fields, no `div` acting as a button, and no canvas on a primary flow

#### Scenario: Existing file is not modified silently
- **WHEN** the instructions file already exists
- **THEN** the skill asks before modifying it

#### Scenario: Run twice
- **WHEN** the skill runs again in a project that already carries the block
- **THEN** it updates that block in place and does not append a second copy

### Requirement: Login and CI are out of reach, and say so
The skill SHALL NOT configure authentication or a CI workflow, and SHALL name where each is documented when it encounters one.

#### Scenario: Login wall found
- **WHEN** a route redirects to a login page
- **THEN** the skill reports that routes behind the login are out of reach for now and points at `docs/auth.md`

### Requirement: The skill cannot drift from the CLI it describes
Wherever the skill presents text as code, every `blastproof` command SHALL be one the CLI has and every flag on that line SHALL be one that command declares. The skill SHALL copy the planner prompt's authoring rules whole rather than paraphrasing them, and the two sets SHALL be equal apart from rules the test excludes by name. Both SHALL be enforced by a test.

#### Scenario: Flag renamed in the CLI
- **WHEN** a flag the skill names is renamed or removed
- **THEN** the test fails, naming the flag and the file that names it

#### Scenario: Command inside a fenced block
- **WHEN** a command or flag appears only in a fenced code block, which is where every command an agent executes appears
- **THEN** it is checked exactly as one written inline

#### Scenario: Flag used on the wrong command
- **WHEN** the skill invokes a real flag on a command that does not declare it
- **THEN** the test fails, naming the flag, the command and the file

#### Scenario: Rule added to the planner prompt
- **WHEN** a rule is added to the planner prompt and the skill does not carry it
- **THEN** the test fails, naming the rule

#### Scenario: Rule reworded, truncated or dropped
- **WHEN** the skill states a rule in different words, keeps only its first sentence, drops it, or states one the prompt does not
- **THEN** the test fails, naming the rule

#### Scenario: Excluded rule
- **WHEN** a rule of the prompt is deliberately absent from the skill
- **THEN** the test names that exclusion explicitly, so a second rule cannot go missing under it

### Requirement: Impact mapping is written with the change, and `ignore:` is bounded
The skill SHALL state that `ignore:` covers files with no user-visible effect, SHALL require a written reason in the pull request when a path under a source directory enters `ignore:`, and SHALL instruct that `routes:` is updated in the same change as the code rather than as a repair after a failing check.

#### Scenario: Source file classified as ignorable
- **WHEN** the agent would silence `--fail-on-unmapped` by adding a path under a source directory to `ignore:`
- **THEN** the skill requires a written reason in the pull request instead of applying it silently

#### Scenario: Mapping written with the change
- **WHEN** the agent changes a file whose blast radius is not yet mapped
- **THEN** it updates `routes:` in that same change, not after `--fail-on-unmapped` reports it
