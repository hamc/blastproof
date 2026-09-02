# Spec delta: agentic-execution (match-the-name-the-model-named)

## MODIFIED Requirements

### Requirement: Live element resolution
The executor SHALL resolve target elements exclusively from the current accessibility snapshot (role/name/text) on every action attempt and SHALL NOT persist selectors between steps or runs. The configured browser timeout SHALL bound how long resolution waits for a candidate element to become visible, and SHALL bound navigation, so that a slow application is waited for rather than retried at.

An accessible name SHALL be matched exactly before it is matched loosely. Each resolution strategy SHALL attempt an exact match and fall back to a substring match only when the exact one finds nothing; strategy order SHALL remain outermost, so a role match still precedes a label or text match regardless of how precisely each matched. The model is instructed to name elements exactly, and the resolver SHALL NOT widen that instruction without first honouring it.

When a match answers to more than one **visible** element, the action SHALL be refused and the model SHALL be told the name is ambiguous and how many controls answer to it, rather than an arbitrary one being chosen. This SHALL apply to the exact attempt and to the loose fallback alike, because a name that is a prefix of two controls is ambiguous precisely on the fallback. The refusal SHALL count as one failed attempt against the existing per-step retry budget.

Ambiguity SHALL be assessed among visible elements only, because a hidden duplicate — a closed menu's options, an unopened modal — is not ambiguous to a user. A loose match resolving to exactly one element SHALL still be used: that is the forgiveness the fallback exists for, and it is distinct from a loose match resolving to several, which is a guess.

A control the page gives no unique accessible name SHALL NOT be resolved by any rule in this requirement, and that is the intended outcome: such a page cannot be driven unambiguously, which is a finding about the application rather than a defect in resolution.

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

#### Scenario: An exact name is not lost to a longer one
- **WHEN** a page shows a button named `Add New` before a button named `Add`, and the model targets `Add`
- **THEN** the button named `Add` is resolved, rather than the first element whose name contains it

#### Scenario: A name that matches nothing exactly still resolves
- **WHEN** no element's accessible name equals the name given, and one contains it
- **THEN** resolution falls back to the substring match, so a snapshot whose text differs by whitespace or truncation still drives the page

#### Scenario: Strategy order outranks match precision
- **WHEN** a role match is available loosely and a text match is available exactly
- **THEN** the role match is used, because the strategy order carries the model's reading of the snapshot

#### Scenario: An ambiguous name is refused, not guessed
- **WHEN** two visible controls share the accessible name the model targeted
- **THEN** the action is refused, the model is told how many controls answer to that name, and one failed attempt is spent

#### Scenario: A name that is a prefix of two controls is refused
- **WHEN** the model targets `Salvar o arquivo` and the page shows `Salvar o arquivo como PDF` and `Salvar o arquivo e sair`
- **THEN** the exact attempt finds nothing, the loose fallback finds two, and the action is refused rather than resolved to whichever comes first in the document

#### Scenario: A loose match with one candidate is still used
- **WHEN** no element's name equals the name given and exactly one contains it
- **THEN** that element is resolved, because one candidate is forgiveness and several is a guess

#### Scenario: A hidden duplicate is not ambiguity
- **WHEN** one visible control and several hidden ones share an accessible name
- **THEN** the visible one is resolved, because ambiguity is assessed among visible elements only
