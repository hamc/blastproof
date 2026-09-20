# Proposal: say-when-the-page-reformatted-a-secret

## Why

`SecretsMask` replaces a secret by escaped literal, case-sensitively, so the guarantee in `AGENTS.md:84` — secrets never enter a prompt — holds only while the page's string is byte-identical to the environment's. The demo app uppercases the promo code it echoes, and #109 reproduced the consequence with no key and no model:

```
registered in the mask : "hunter2"
snapshot AFTER         : - status: Unknown promo code "HUNTER2".
secret still readable  : YES — leaked
```

The limit should stay documented: no mask can cover a value an application base64-encodes or hashes. **What is not acceptable is that the failure is silent** — a run whose secret leaked and one whose secret was masked produce the same score, exit code and output.

And part of it is not a limit at all. A value differing only in case or spacing is one the tool can recognise: `agentic-execution` already compares a model-supplied value against the page that way, "case-insensitive with runs of whitespace collapsed".

## What Changes

- The mask SHALL redact an occurrence that matches a registered value under that same normalization — case-insensitively, with runs of whitespace matched loosely — and not merely the literal and percent-encoded forms.
- When it redacts something only the widened comparison found, the run SHALL say so once per variable, naming the **variable** and never the value: the page returned that secret in a form the tool nearly missed, and one it cannot recognise would have leaked.
- No transform list. Nothing is added for base64, hashing, truncation or any other re-encoding, and the documentation SHALL keep saying so.
- The documentation SHALL state the boundary in these terms: comparison, not enumeration; a warning where a near-miss is detectable; silence where it is not.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agentic-execution`: the mask's comparison is defined, rather than being whatever the implementation does, and a detected near-miss is reported

## Impact

- New dependencies: **none**
- Affects `src/runner/env.ts` (the comparison, and the names it must keep alongside the values), the warning path in `src/commands/run.ts`, their tests, `AGENTS.md`, `README.md` and `skills/blastproof/references/authoring.md`
- Strictly wider than today: everything masked now stays masked
- A step asserting on an `{{env.*}}` value was already unassertable (#87), and now is in a few more cases — the README's #87 paragraph must say so

## Non-goals

- **Not a transform catalogue.** An enumeration never closes, and a mask implying completeness stops people being careful
- **Not "warn when a registered secret never appears".** That fires on the common case — most secrets are typed and never echoed — and teaches people to ignore it (#103). The signal here is narrow: something was redacted that the literal comparison would have missed
- **Not the report.** Where warnings belong in the HTML and JUnit output is #103's subject; this one prints to the terminal like every other warning
- **Not a failing exit code.** A page echoing a secret in another case is not a broken test, and gating on it would block merges over the application's formatting
