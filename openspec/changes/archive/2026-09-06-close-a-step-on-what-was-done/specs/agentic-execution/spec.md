# Spec delta: agentic-execution (close-a-step-on-what-was-done)

## ADDED Requirements

### Requirement: A step closes on what was done, not on being declared done
The executor SHALL NOT close a step on a `done` action when no action succeeded during that step. The attempt SHALL be refused rather than performed, the refusal SHALL be returned to the model as that action's result together with the reason, and it SHALL count as one failed attempt against the existing per-step retry budget.

An action counts only when it succeeded: an action that raised is not evidence that anything happened. A passing assertion closes the step before `done` is reachable, so this requirement needs no separate rule for verification steps — a step that verified nothing and a step that did nothing are the same case.

The refusal SHALL state what closes a step instead: a step whose outcome already holds is closed by **asserting that it holds**, which the judge decides against the page, rather than by declaring the step complete. The executor cannot distinguish "there was nothing to do" from "this could not be done", and SHALL NOT try — it requires the outcome to be shown rather than stated.

This requirement applies to setup steps on the same terms as ordinary ones, because everything after a setup step proceeds on a precondition it was supposed to establish.

#### Scenario: A step whose target does not exist does not pass
- **WHEN** a step names a control the page does not have, and the model answers `done` saying the step cannot be completed
- **THEN** the step fails rather than passing, so its priority weight does not reach the score

#### Scenario: An action that succeeded closes the step
- **WHEN** a step fills a field successfully and the model then answers `done`
- **THEN** the step closes as before

#### Scenario: A failed action is not evidence
- **WHEN** an action raises, and the model answers `done` on the next turn
- **THEN** the `done` is refused, because nothing succeeded during the step

#### Scenario: An outcome that already holds is asserted, not declared
- **WHEN** a step asks for something the page already satisfies and the model asserts that it holds
- **THEN** the assertion is judged against the page and closes the step normally

#### Scenario: A model that insists terminates on the retry budget
- **WHEN** the model answers `done` repeatedly with nothing succeeding
- **THEN** the failed attempts accumulate and the step fails on the existing retry budget, with the refusal as its reason

#### Scenario: A setup step is held to the same rule
- **WHEN** a setup step accomplishes nothing and the model answers `done`
- **THEN** it is refused on the same terms, because the steps after it depend on the precondition it did not establish
