# Spec delta: test-generation (isolate-a-failed-write)

## MODIFIED Requirements

### Requirement: Per-route isolation
A failure affecting one route SHALL NOT prevent generation for the remaining routes. This SHALL hold for a failure to persist a draft as well as a failure to generate one, and SHALL NOT depend on which kind of error was raised: every draft is a model call against a live page, so the routes still to come are worth more than any distinction between one filesystem fault and another.

#### Scenario: One route fails to load
- **WHEN** generation is requested for `/cart` and `/settings` and `/settings` fails to load
- **THEN** `/cart` still produces a draft and `/settings` is reported as failed with its reason

#### Scenario: One route fails to persist
- **WHEN** three routes are generated with `--write` and the second cannot be written
- **THEN** the third is still attempted, the second is reported as failed with its reason, and the run exits non-zero

#### Scenario: A write failure the command does not recognise
- **WHEN** persisting a draft raises an error of a kind the command does not handle
- **THEN** that route is reported as failed and the remaining routes are still attempted, rather than the run ending with no summary
