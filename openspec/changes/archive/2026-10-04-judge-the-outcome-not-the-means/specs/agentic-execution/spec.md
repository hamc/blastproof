# Spec delta: agentic-execution (judge-the-outcome-not-the-means)

## ADDED Requirements

### Requirement: A step is judged on the state it asks for, not on its action
A judgment SHALL decide whether the state a step asks for holds on the page, and SHALL NOT require evidence that the step's action was performed. An outcome that already held before the step acted, whether an earlier step or the application produced it, SHALL pass. An outcome that is an absence (something gone, closed, dismissed or removed) SHALL be satisfied by that thing being absent from the snapshot, and an element the step does not name SHALL NOT count for or against it.

The judgment SHALL state that outcome first, as a sentence about the page with the step's action removed, before its reason and its verdict.

The means by which a step reaches its outcome SHALL NOT be checked. A snapshot records a state, not the path to it. The authoring reference SHALL say so, and that a step whose means matters names what the means leaves on the page.

#### Scenario: A dialog already gone passes a step that dismisses it
- **WHEN** a step asks to dismiss the cookie consent dialog by clicking "Me want it!" and verify it is gone, and the snapshot shows no consent dialog because an earlier step dismissed it
- **THEN** the step passes, although this step clicked nothing

#### Scenario: A dialog still shown fails the same step
- **WHEN** the same step is judged on a snapshot that still shows the consent dialog, whatever the model's claim says
- **THEN** the step fails

#### Scenario: Closing a different dialog does not satisfy the step
- **WHEN** the step's record shows the Welcome banner was closed, and the snapshot still shows the consent dialog
- **THEN** the step fails, because the dialog the step names is present

#### Scenario: The outcome is stated before the verdict
- **WHEN** any judgment is made
- **THEN** its response gives the step's outcome as a sentence about the page before it gives its reason and its verdict

## MODIFIED Requirements

### Requirement: A step's outcome cannot be satisfied by substituting an easier claim
Because the judgment is anchored to the step rather than to whatever the model most recently proposed, a model SHALL NOT be able to close a step whose outcome has not been reached by offering a different claim that happens to hold. Retrying after a failed judgment SHALL continue to be judged against the same step.

The judgment's own response format SHALL ask the same question: whether the snapshot shows the **step's** outcome, the expectation being only a claim offered in support. It SHALL fail when any part of the outcome the step asks for is not shown, or cannot be assessed from the snapshot. Its outcome and its reason SHALL be produced before its verdict.

#### Scenario: Substitution after a failed judgment
- **WHEN** an expectation fails because the step's outcome has not been reached, and the model then offers an unrelated claim that is true of the page
- **THEN** the judgment still fails, because the step's outcome is what is being decided

#### Scenario: A weakened expectation does not lower the bar
- **WHEN** a step asks to open the Account menu and verify the email it shows, and the model offers "the page redirected away from login, or the Account menu is accessible", and only the redirect is shown
- **THEN** the judgment fails, because the step's outcome is not shown

#### Scenario: A legitimate second attempt still works
- **WHEN** an expectation fails because the page had not yet reached the state the step describes, and the state is reached on a later attempt
- **THEN** the judgment passes, because the step's outcome now holds

#### Scenario: The expectation remains visible
- **WHEN** any judgment is recorded
- **THEN** the model's expectation and the judge's reason are still reported, so a reader can see what was claimed as well as what was decided
