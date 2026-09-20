# Design: say-when-the-page-reformatted-a-secret

## Context

The mask is a set of strings and a literal replace (`src/runner/env.ts`):

```ts
this.secrets.add(value);
const encoded = encodeURIComponent(value);
if (encoded !== value) this.secrets.add(encoded);
...
masked = masked.replace(new RegExp(escapeRegExp(secret), 'g'), '***');
```

Four things I read rather than assumed:

**The project already has this normalization, written down.** `agentic-execution` ("A typed value must come from the test or the application") compares a model-supplied value to the page "case-insensitive with runs of whitespace collapsed. No further normalization." This change does not invent a rule; it applies the one already argued for to the other direction of the same problem.

**The mask is already a choke point.** `runOne` passes one closure, `mask: (text) => mask.mask(text)`, and the executor funnels the snapshot, the action record, the last result, the step text and the failure reason through it (`executor.ts:234–491`). Widening `mask()` widens every channel at once — which is exactly what `AGENTS.md` says a guarantee must do, and the opposite of the defect it names.

**The mask knows the names, and then throws them away.** `registerFrom` iterates `referencedEnvVars(text)` and calls `add(value)`. To name a variable in a warning, the value must keep its name.

**Ordering matters and must survive.** `maskSecrets` sorts longest-first so a short secret cannot mask inside a longer one. Whatever the comparison becomes, that stays.

## Goals / Non-Goals

**Goals:**
- A value the page reformatted in case or spacing is redacted, in every channel, including the reports
- Where that happened, the person is told, once, with enough information to act and nothing they must then keep secret
- The remaining limit stays stated, and stays honest

**Non-Goals:** a transform catalogue, a new exit code, anything about where warnings appear in the reports (#103), and the screenshot (#110, done).

## Decisions

### D1: One regex per secret, built from the value
For each registered value, the pattern is the escaped literal with each run of whitespace replaced by `\s+`, matched with `gi`:

```
"hunter2"        -> /hunter2/gi
"open sesame"    -> /open\s+sesame/gi
```

Case-insensitivity covers the reproduction in #109. `\s+` covers a page that re-wrapped or re-spaced the value, and it subsumes the "runs of whitespace collapsed" half of the existing rule without needing to normalize the haystack — which matters because the haystack is the text we must return with everything else intact.

The percent-encoded form keeps its own entry, as today: `%20` is not whitespace to a regex, and the resolved-URL case that put it there has not changed.

Alternatives: normalizing both sides and mapping offsets back (more code, same result, and the offset map is where the bugs would be); a similarity threshold such as Levenshtein (unbounded false positives on short values, and no principled cut-off).

### D2: A near-miss is a match that is not byte-identical
The mask replaces through a callback, so each match is in hand:

```ts
text.replace(pattern, (found) => {
  if (found !== value) this.nearMisses.add(name);   // case or spacing differed
  return '***';
});
```

No second pass, no separate literal scan. The signal is precise by construction: it fires only where the old comparison would have left the value in the text.

### D3: The mask carries names; the run reports them
`registerFrom` records `value -> name`; `add(value)` without a name stays supported and still masks, but records no near-miss, because there is no name to report and a warning that cannot say which variable to look at is noise. Nothing in `src/` registers an unnamed value — every path goes through `registerFrom` — so this is a property of the API, not a case the run can reach.

`SecretsMask` accumulates the set of variable names near-missed and exposes it read-only. `run` drains it after the tests and before the score, on stderr, where `printUncommitted` and the unmapped report already print:

```
warning: the application returned PROBE_SECRET in a different form than the value supplied
  (case or spacing). It was redacted, but a form this tool cannot recognise — an encoding,
  a hash — would not have been. Check what the page does with that value.
```

The value appears in neither form. Printing at the end rather than inline keeps the per-step output as it is, and makes "once per variable" trivially true rather than something the printer has to remember mid-run.

### D4: Detected, redacted, and not fatal
A near-miss does not fail a step, does not change the score and does not change the exit code. The application's formatting is not a defect in the test, and a merge gate that blocks on it would be a gate on the application's display logic. The warning is the whole output, deliberately.

### D5: The limit keeps being documented, in the same places
`AGENTS.md:84`, the README's *Trust boundaries*, and the skill's authoring reference say what the comparison now is and what it still cannot see. This is the fourth time the project has answered "the rule was satisfied by the letter" by naming the property instead of extending a list (#57, #60, #72, #100); the documentation should read as the property, not as a feature list.

## Risks / Trade-offs

- **Over-masking.** Case-insensitivity makes a short or word-like secret (`demo`, `test`) match more text, and every match is unassertable (#87). → The README's #87 paragraph gains a sentence, and the advice it already gives — do not assert on an `{{env.*}}` value — is unchanged and now matters slightly more.
- **A near-miss warning on a non-secret.** Teams use `{{env.*}}` for environment-varying values that are not secret, so the warning can name something harmless. → It names the variable and says what was observed, not what to do; the reader knows whether it is a secret.
- **False silence remains possible**, for base64, hashes and truncation. → That is the documented boundary, and the warning's wording says so explicitly rather than implying coverage.
- **Cost.** One regex per registered value per masked string, which is what happens today; the regex is built once per value, not per call.

## Migration Plan

None. Strictly more masking than before, plus one warning line on runs where the widened comparison changed something.

## Open Questions

- **Should `plan` warn too?** It masks the pages it snapshots with its own `SecretsMask`, and the same near-miss can happen there. The reporting path is different enough (one command, no run summary) that it is worth doing after this lands, if the warning proves useful.
