# Design: keep-the-open-dialog-in-the-snapshot

## D1. Anchors, in order

An anchor is a line whose role is `dialog` or `alertdialog`, or a line carrying `[active]`. They are taken in this order: the **last** dialog in document order, then every `[active]` line, then the remaining dialogs from last to first. The last dialog first, because a portal appends, so the last one is the one opened last and the one on top. Focus second, because a focused field outside any dialog (a grid cell being edited) is what the next action types into.

For each anchor, its ancestors are kept first (the lines of smaller indent above it), then its subtree in order, until the budget is spent. The ancestors are a handful of lines, and without them the anchor's indentation hangs from nothing. Then the budget is filled from line 0 downwards. Lines already kept are not counted twice.

## D2. Markers in place

The old marker sat at the end and said "truncated after N lines", which was true only of a cut from the top. Now the kept lines can have gaps anywhere, so each gap is one line at the indentation of its first dropped line: `- ... (N lines omitted: max_snapshot_lines is M)`. Naming the setting tells a reader of a failure screenshot or log which knob caused it. The markers sit outside the budget, as the old one did: there are at most two per anchor plus one.

## D3. The reason names the cap

The executor knows the snapshot it last judged or acted on. When a step fails and that snapshot holds a marker, the reason gets one sentence: *"The page's snapshot was cut at max_snapshot_lines (M); what the step looks for may be in the part left out."* It is read from the marker, so it cannot disagree with what was cut. It is a hint, not a verdict change: the step still fails.

## D4. Roles from the line, not from the DOM

The anchors are read from the snapshot text, as `indexRefs` reads refs, including YAML single-quoted lines. That needs nothing from the page beyond the one `ariaSnapshot` call already made, so the planner, the login journey and the executor all get it from the same pure function.
