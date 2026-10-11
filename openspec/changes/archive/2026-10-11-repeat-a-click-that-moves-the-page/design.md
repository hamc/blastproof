# Design: repeat-a-click-that-moves-the-page

## D1. What separates a tour from a duplicate

Both measured duplicates (#28 on Gitea, #124 on the demo app) re-establish the form before re-submitting: a `fill`, or a click on "New Issue". The page had lost the evidence, so the model rebuilt the precondition. A tour, a wizard or a "load more" button needs no precondition between presses, only the press. So the exception requires the repeat to follow its own previous success directly. Any successful action in between, of any kind, closes it. Failed and refused attempts and judgments do not count as actions, since they change nothing.

## D2. "The page moved"

The executor already gives `observe` the masked, ref-less snapshot (`pageSnap`) before every decision, and again on re-observation after a failed judgment. `StepRecovery` keeps the last one. `record` stores it with the commit as "the page this commit was decided on". A repeat is allowed when the latest observation differs from that stored page. Compared exactly, after the refs are stripped: refs are renumbered on re-render, and the comparison must not call a re-rendered identical page a change.

Exact comparison means any visible difference counts, a clock included. That errs toward allowing, and it is bounded by D1: the only thing allowed is a press directly after itself.

## D3. Residual risk, stated

A form that keeps its values after submit and shows the new record on the same page lets a consecutive second submit through, because the page moved. The model would have to click "Add" again while the new record is in the snapshot it reads. Neither reproduction has this shape. Making it impossible would mean telling a tour's "Next" from a form's "Add", which the accessibility tree cannot do (contained-recovery's founding observation). The notes test is re-run 5 times on #124's model to show the shape that is known still holds.

## D4. No wording change

The refusal for a repeat that is still refused stays word for word. The executor rule that it reads was measured (#124, refs D5), and nothing here needs the model to know about the exception: the model proposes "Next" again, and it either goes through or is refused as before.
