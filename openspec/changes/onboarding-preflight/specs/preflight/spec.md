## ADDED Requirements

### Requirement: Unmet prerequisites are reported together, before anything is spent
Before executing tests or generating drafts, the tool SHALL verify that the browser can launch, that the configured model provider is reachable, and that `base_url` responds. Every failing check SHALL be reported in one message; the run SHALL NOT stop at the first failure and discover the rest one execution at a time. When every check passes, preflight SHALL produce no output.

#### Scenario: Several prerequisites are unmet
- **WHEN** the browser cannot launch and the model provider is unreachable
- **THEN** both are reported together, each naming what failed and what to do about it, and the process exits 2

#### Scenario: All prerequisites met
- **WHEN** every check passes
- **THEN** preflight prints nothing and the run proceeds

#### Scenario: The application is not running
- **WHEN** `base_url` does not respond
- **THEN** preflight reports it before any model call is made

#### Scenario: Checks that cost nothing to skip
- **WHEN** a command needs neither browser nor model, such as a dry run
- **THEN** the checks that do not apply to it are not performed

### Requirement: A failed browser launch explains itself
When the browser cannot start, the tool SHALL report the cause and the remedy in a message a user can act on, and SHALL NOT surface the underlying automation library's raw exception. The message SHALL name the missing component and SHALL state that installing system libraries requires elevated privileges, since that is the point at which a user without them needs to know the keyless path exists.

#### Scenario: A system library is missing
- **WHEN** the browser fails to start because a shared library is absent
- **THEN** the message names the missing library and the command that installs it, notes that it needs elevated privileges, and does not print the browser's command line

#### Scenario: The browser was never installed
- **WHEN** the browser executable does not exist
- **THEN** the message says so and names the command that installs it

#### Scenario: The cause is not recognised
- **WHEN** the launch fails for a reason the tool does not recognise
- **THEN** the underlying error is still shown, so an unanticipated failure is never swallowed

### Requirement: An unknown configuration key is reported
Loading configuration SHALL report any key it does not recognise, naming the key and where it appeared. An unknown key SHALL NOT stop the run: configuration written for a newer version must remain usable on an older one.

#### Scenario: A key that does nothing
- **WHEN** the configuration contains a key the running version does not recognise
- **THEN** a warning names that key, and the run continues

#### Scenario: A setting believed to be in effect
- **WHEN** a user configures a section this version does not support
- **THEN** the warning makes clear the setting is having no effect, rather than leaving them to assume it applies
