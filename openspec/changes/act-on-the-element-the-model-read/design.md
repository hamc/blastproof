# Design: act-on-the-element-the-model-read

## D1. Resolve the ref, not a description

The loss is in the round trip. The model reads one element and writes a description, and the resolver searches for the description. Every rule we added to the search (exact before substring, role before label before text) made a guess better, and none removed it. `aria-ref` removes the search. The ref is not a static selector: it is valid only for the snapshot it came from, it is never stored past the action, and a fresh one is read on every iteration. That is the live-resolution rule, held more strictly.

Rejected:
- **Refusing an ambiguous name.** It was measured in `match-the-name-the-model-named` (D2/D7): a screen-reader twin shares the role and name and counts as visible.
- **Passing position or structure into the search.** It widens a guess.

## D2. The model's role and name are a check, not a key

The schema keeps `role` and `name` beside `ref`. The ref alone decides the element. The pair is compared with what the snapshot line for that ref shows: role exactly, name with the mask's normalisation (case and runs of whitespace). A mismatch is refused as a failed attempt naming both, for example `ref f1e16 is button "Apply promo code", not button "Checkout"`.

The new failure mode is a model copying the ref of a neighbouring line, and this turns it into a visible retry instead of a wrong click. Where the line has no accessible name, its inline text (`- generic [ref=e14]: Promo code`) is compared instead. Where it has neither, the model's name must be empty. A role the model omits is refused, so #132's shape (a role, no name) cannot come back through the check.

## D3. Every snapshot in AI mode, refs only where actions are chosen

A plain `ariaSnapshot()` invalidates the refs of the last AI-mode one, measured. So `captureSnapshot` always uses AI mode, and strips `[cursor=pointer]`.

The executor's prompt keeps the refs. The judge and the planner get the same text with refs removed: they choose no element, and the judge corpus's stored snapshots have none. AI mode also lists unnamed `generic` containers and marks `[active]`. Both stay, because they are the page's structure and focus, not ids.

## D4. A stale ref fails fast

`locator('aria-ref=…').count()` returns 0, or throws "Invalid frame" after a navigation, within milliseconds. Resolution checks the count before acting. Zero, or the throw, is an `ActionError` telling the model the page changed since its snapshot, and the next iteration takes a fresh one. Waiting `browser.timeout_ms` for an element that was replaced could only time out.

A slow element is still waited for: it is not in the snapshot yet, so the model cannot name its ref. That case is unchanged.

## D5. Identity and report use the snapshot's words

`describeAction`, the result line and `recovery.ts`'s commit identity use the role and name from the ref's snapshot line. Refs are not used, because a re-rendered button gets a new ref and the #124 duplicate commit would pass. The names are taken from the masked snapshot, so no secret enters the record. This also closes #132's last point: the log names the element actually clicked.

## D6. Measured, not assumed

Verification runs the reliability benchmark on `claude-haiku-4.5`, `gpt-6-luna` and `gpt-oss-20b`, 5 samples, against the numbers in `docs/configuration.md`. It also replays the judge corpus. A rise in false FAIL on a default model, or a model that does not fill `ref`, is a finding for this change before it merges. Executor tokens per run are reported before and after.

## D7. The repeat refusal names the element and disowns the ref (found in verification)

The commit-repeat refusal said "this exact action already succeeded". On `main` the repeated action was textually identical, and Haiku believed it. After a reload the same button has a new ref, so the action the model proposed was not "exact" in its own eyes. It insisted until the retry budget ran out, on 4 of 5 runs of the notes test (`main`: 0 of 5). The refusal now says which element (`click on button "Add note"`) and that refs are renumbered when the page changes. With that change, 5 of 5 passed. The identity was right; the wording was out of date.
