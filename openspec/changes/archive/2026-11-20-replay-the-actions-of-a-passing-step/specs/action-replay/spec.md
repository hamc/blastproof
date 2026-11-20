## ADDED Requirements

### Requirement: A passing test saves the actions of its steps
When replay is on and a test passes, the system SHALL save, for each of its steps, the actions that succeeded in that step in order, and how the step closed. A saved action SHALL hold the action, the role and the name the snapshot showed for its target (its inline text when it has no name), the value as written before `{{env.*}}` is resolved, and whether the page differed after it, with refs and the mark of the focused element aside. How a step closed SHALL be `done`, or `judgment` with the claim the judge passed.

A failed attempt, a refused action and a failed assertion SHALL NOT be saved. A resolved `{{env.*}}` value, a ref, a CSS selector and an XPath SHALL NOT be saved.

Each saved step SHALL carry a key made from its position in the test, its text as written and its text as judged. The test's file SHALL carry the device the test ran as.

A test that failed SHALL save no new step, and SHALL leave its file as it is when no replay ended in it. The test a run was in when it was stopped (budget, deadline, or a provider that gave no response) SHALL write nothing.

#### Scenario: A secret is saved as its placeholder
- **WHEN** a passing step filled a field with `{{env.TEST_PASSWORD}}`
- **THEN** the saved action's value is `{{env.TEST_PASSWORD}}`, and the file does not contain the variable's value

#### Scenario: Only what worked is saved
- **WHEN** a step passed after one refused click and two successful actions
- **THEN** two actions are saved for it

#### Scenario: A failed test saves nothing new
- **WHEN** a test fails at its third step
- **THEN** no step of that run is added to the test's file

### Requirement: A saved step is replayed in place of asking the model
When replay is on and a step has a saved entry whose key and device match, each saved action SHALL be the step's next decision in place of a call to the model. A replayed action SHALL pass every check a model's action passes before it is performed, and SHALL be recorded as a model's action is.

The target of a replayed action SHALL be found in a fresh snapshot by role and name, compared case-insensitively with runs of whitespace collapsed. Exactly one matching element SHALL give the ref to act on. The system SHALL NOT choose among several matches by position.

A step with no matching entry SHALL run as it does with replay off.

#### Scenario: An unchanged step asks the model for no action
- **WHEN** a step has a saved entry and the page shows each saved target exactly once
- **THEN** the saved actions are performed in order and the model is not asked for an action in that step

#### Scenario: An edited step is not replayed
- **WHEN** the text of a step, or of the check that follows it and is judged with it, differs from the one its entry was saved for
- **THEN** the entry is not used and the model is asked

#### Scenario: A repeated commit is still refused
- **WHEN** a saved action is a commit the step already performed and the repeat rule refuses it
- **THEN** it is not performed and the replay of that step ends

### Requirement: A check is judged on the live page on every run
A replayed step that closed by `judgment` SHALL be judged after its saved actions, on the current page, with the saved claim, exactly as an assertion is judged. A verdict SHALL NOT be saved or reused.

A replayed step that closed by `done` SHALL close when every saved action was performed and, for each action after which the page had differed when it was saved, the page differs again.

#### Scenario: A bug the check names is still caught
- **WHEN** a step's saved actions are performed on an application where the step's outcome no longer appears
- **THEN** the judgment fails on the live page, and the step does not pass on the saved claim

#### Scenario: A verification step is one judgment
- **WHEN** a step that only checks has a saved claim and the page still shows what it checks
- **THEN** the step passes on one judgment, and the model is not asked for an action

### Requirement: A replay that stops working hands the step to the model
The replay of a step SHALL end, and the model SHALL be asked from that point on with the step's record as it stands, when any of these happens:

- a saved target matches no element of the snapshot, or more than one;
- a replayed action is refused;
- a replayed action raises;
- the page had differed after a saved action and does not differ now, within the time the executor already watches a page still rendering. A move of the focus alone SHALL NOT count as a difference. While it watches, the executor SHALL NOT read a page outside the allowed origins;
- the judgment of a step that closed by `judgment` fails, after the re-observation every failed judgment gets.

An ended replay SHALL NOT spend the step's retry budget. Actions the replay performed SHALL stay in the step's record. A replay SHALL be used at most once per step.

A step whose replay ended SHALL be removed from the test's file at the end of the test. When the test passes, the actions of that run SHALL be saved in its place.

#### Scenario: A renamed button heals
- **WHEN** a saved action targets `button "Add note"` and the page now shows `button "Save note"` instead
- **THEN** the replay ends without a failed attempt, the model resolves the step, and when the test passes the new actions replace the saved ones

#### Scenario: Two controls of the same name
- **WHEN** a saved action targets `button "Delete"` and the page shows two buttons named "Delete"
- **THEN** neither is clicked by the replay, and the model is asked

#### Scenario: A replayed action that does nothing
- **WHEN** a saved click had changed the page and the same click now leaves it unchanged
- **THEN** the replay ends and the step is not closed on that click

#### Scenario: A click that only moves the focus
- **WHEN** a saved click had changed the page, and the same click now changes nothing but which element the snapshot marks as focused
- **THEN** the replay ends and the step is not closed on that click

#### Scenario: A page that leaves the application while it is watched
- **WHEN** a replayed submit is followed, a moment later, by a redirect to an origin outside the allowed ones
- **THEN** that page is not read by the judge or the model, and the step fails as a page that left the application

#### Scenario: The model does not repeat what the replay did
- **WHEN** a replay submitted a form and then ended on a failed judgment
- **THEN** a click on the same button by the model is refused as a repeated commit

### Requirement: The saved actions are a disposable local file
Saved actions SHALL be stored under `.blastproof/cache/`, one file per test, written by a temporary file and a rename. The directory SHALL be safe to delete at any time: a missing, unreadable or older-format file, and a saved step with a field of the wrong type, SHALL be treated as nothing saved, and SHALL NOT fail the run or a step.

#### Scenario: A deleted directory
- **WHEN** `.blastproof/cache/` is removed between two runs
- **THEN** the next run asks the model for every action and saves again

#### Scenario: A corrupt file
- **WHEN** a test's file is not valid JSON
- **THEN** the test runs with nothing saved, and the run does not fail for it

### Requirement: The run says how each step was decided
Each step's result SHALL say whether it was replayed, resolved by the model, or healed (its replay ended and the model finished it). With replay on, the terminal summary SHALL give the three counts in one line.

#### Scenario: Summary line
- **WHEN** a run with replay on replays 21 steps, and the model resolves 2 of which 1 had a replay that ended
- **THEN** the summary shows `Replay: 21 steps replayed, 2 resolved by the model (1 healed)`
