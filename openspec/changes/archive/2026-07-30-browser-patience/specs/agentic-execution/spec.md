## MODIFIED Requirements

### Requirement: Live element resolution
The executor SHALL resolve target elements exclusively from the current accessibility snapshot (role/name/text) on every action attempt and SHALL NOT persist selectors between steps or runs. The configured browser timeout SHALL bound how long resolution waits for a candidate element to become visible, and SHALL bound navigation, so that a slow application is waited for rather than retried at.

#### Scenario: Self-healing after UI change
- **WHEN** an action fails because the target element is not found
- **THEN** the executor retries with a fresh snapshot, allowing the LLM to pick an alternative element, up to the configured per-step retry budget (default 3)

#### Scenario: A slow element is waited for
- **WHEN** the configured browser timeout is 10 seconds and a target element becomes visible after 4 seconds
- **THEN** resolution succeeds without consuming a retry, because waiting is bounded by the configured timeout rather than by a fixed shorter one

#### Scenario: Navigation honours the configured timeout
- **WHEN** a `navigate` action runs against an application configured with a browser timeout
- **THEN** that timeout bounds the navigation, rather than a value fixed in the code

#### Scenario: The timeout is a wait, not a retry
- **WHEN** an element never appears within the configured timeout
- **THEN** the attempt fails and the existing retry budget applies unchanged, so raising the timeout never increases the number of attempts

## ADDED Requirements

### Requirement: The accessibility snapshot cap is configurable
The number of accessibility-tree lines sent to the model SHALL be configurable, defaulting to the current value. Truncation SHALL remain visible in the snapshot so the model is not misled into believing it has seen the whole page.

#### Scenario: Default preserved
- **WHEN** no cap is configured
- **THEN** the snapshot is capped at the established default, exactly as before

#### Scenario: A dense page raises the cap
- **WHEN** an application's pages exceed the default and the cap is raised
- **THEN** more of the accessibility tree reaches the model, bounded by the configured value

#### Scenario: Truncation stays visible
- **WHEN** a snapshot is truncated at whatever cap applies
- **THEN** the snapshot states that it was truncated
