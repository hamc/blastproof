# Testing behind a login

Most journeys worth testing are behind a sign-in. Declare a recipe once in
`.blastproof/config.yaml`; blastproof signs in **one time per run** and reuses
that session for every test and for `plan`.

Pick exactly one of the three strategies below. They are alternatives, not
layers — declaring two is a configuration error rather than a fallback chain,
because a silent fallback would hide which one actually authenticated you.

## 1. A plain-English journey

For a form login, or anything a person can click through.

```yaml
auth:
  steps:
    - navigate to /login
    - fill the email field with {{env.TEST_EMAIL}}
    - fill the password field with {{env.TEST_PASSWORD}}
    - submit the login form
  verify: a signed-in indicator is visible
```

The steps are ordinary blastproof steps, driven by the same agent against the
same accessibility tree — so the same authoring rule applies: **say what each
step should produce**. A login form that redirects on success is exactly the
shape that erases its own evidence.

### `verify` is worth the extra model call

It is optional and strongly recommended.

Without it, a wrong password surfaces as *every test failing on a login wall* —
N failures, none of which names the cause. You spend a full run and a full
budget to learn that a secret was mistyped.

With it, authentication failure **exits 2 and reports no failing tests at all**,
because a login you could not complete says nothing about the code under review.
That distinction is the same one behind `not run`: never report a verdict about
an application you did not actually exercise.

## 2. A session captured by hand

For SSO, MFA, magic links — anything that cannot be scripted as a journey.

```yaml
auth:
  storage_state: .blastproof/auth.json
```

The file is a Playwright storage state: cookies plus local storage, captured
from a browser where you signed in yourself.

To produce one:

```bash
npx playwright open --save-storage=.blastproof/auth.json http://localhost:4173
```

Sign in in the window that opens, complete whatever second factor applies, then
close it. The file is written on close.

**A captured session is a credential.** The file holds live cookies, and anyone
holding it is signed in as you. `blastproof init` adds it to `.gitignore`;
never commit one, and treat it in CI exactly as you would a password — a secret
written to disk at job start, not a file in the repository.

Sessions expire. When a suite that worked yesterday fails everywhere on a login
wall today, recapture before debugging anything else.

## 3. Static values

For token-based applications with no interactive login at all.

```yaml
auth:
  headers:
    Authorization: "Bearer {{env.API_TOKEN}}"
```

Headers are sent with every request the browser makes for the duration of the
run.

## Secrets

Everywhere above, `{{env.VAR}}` is the only way to reference a credential.

**The placeholder is what the model sees.** It survives intact through every
prompt and is substituted at the moment of typing — the real value exists
between the substitution and the keystroke, and never enters a page snapshot, a
step record, a log line or a report.

**A step may only use a variable it names.** The agent cannot type
`{{env.API_TOKEN}}` into a field unless the step it is executing references
`{{env.API_TOKEN}}`. This is enforced, not asked: a placeholder naming any other
variable is refused and never substituted. Without it, an agent facing a step
that supplies no value could name a variable of its own — and a secret nobody
pointed at that field is also a secret the redaction above was never told to
protect, since it registers the values your steps and your recipe reference.

Every value your tests or auth recipe reference is redacted from everything else
crossing into a prompt, in both literal and percent-encoded form. Redaction
matches known values, so treat it as a strong default rather than a guarantee
against a deliberately hostile application.

In output, a redacted value appears as `***`. The judge is told explicitly that
a field holding `***` is filled rather than empty, so a redacted password does
not cause a step to fail for being unverifiable.

## Running a test signed out

A login test must not run inside an already-authenticated session — it would
pass without proving anything.

```yaml
summary: Signing in with valid credentials reaches the dashboard
priority: P0
auth: false
routes: ["/login"]
steps:
  - navigate to /login
  - fill the email field with {{env.TEST_EMAIL}}
  - fill the password field with {{env.TEST_PASSWORD}}
  - submit the login form and verify the dashboard heading is shown
```

`auth: false` on a test opts it out of the run's session entirely.

## What is not supported

Authentication that requires reading a code from an email inbox, an SMS, or an
authenticator app cannot be automated here — use strategy 2 and capture the
session by hand.

An identity provider on a different host needs that host declared in
`allowed_origins:`, or the agent will refuse to follow the redirect. See
[Trust boundaries](../README.md#trust-boundaries).
