import { describe, expect, it } from 'vitest';
import { StepRecovery } from '../src/runner/recovery.js';
import type { AgentAction } from '../src/llm/schemas.js';

// Design repeat-a-click-that-moves-the-page (#164): a commit that follows itself
// on a page that moved is performed; every other repeat is refused as before.

const click = (name: string): AgentAction => ({ action: 'click', target: { role: 'button', name }, reasoning: 'r' });
const fill = (value: string): AgentAction => ({
  action: 'fill',
  target: { role: 'textbox', name: 'Note' },
  value,
  reasoning: 'r',
});
const enter: AgentAction = { action: 'press', value: 'Enter', reasoning: 'r' };

/** Observe a page, then perform `action` on it if it is not refused. */
function attempt(recovery: StepRecovery, page: string, action: AgentAction): string | undefined {
  recovery.observe(page);
  const refusal = recovery.refusalFor(action);
  if (refusal === undefined) recovery.record(action, action.action, 'ok');
  return refusal;
}

const tour = (stop: number): string => `- dialog:\n  - text: ${stop} of 8\n  - button "Next"`;

describe('a repeated commit (spec agentic-execution, #164)', () => {
  it('is performed when it follows itself on a page that moved, as a tour does', () => {
    const recovery = new StepRecovery('click "Next" until the tour shows its last step');
    for (let stop = 1; stop < 8; stop++) {
      expect(attempt(recovery, tour(stop), click('Next'))).toBeUndefined();
    }
  });

  it('is performed for a repeated Enter that moved the page', () => {
    const recovery = new StepRecovery('press Enter until the list ends');
    expect(attempt(recovery, '- listitem: one', enter)).toBeUndefined();
    expect(attempt(recovery, '- listitem: two', enter)).toBeUndefined();
  });

  it('is refused when a fill came in between, the #124 shape', () => {
    const recovery = new StepRecovery('submit the add-note form with Check the invoice');
    attempt(recovery, '- textbox "Note": Check the invoice\n- button "Add note"', click('Add note'));
    attempt(recovery, '- textbox "Note"\n- button "Add note"\n- listitem: Check the invoice', fill('Check the invoice'));
    const refusal = attempt(
      recovery,
      '- textbox "Note": Check the invoice\n- button "Add note"\n- listitem: Check the invoice',
      click('Add note'),
    );
    expect(refusal).toContain('refused:');
  });

  it('is refused when another click came in between, the #28 shape', () => {
    const recovery = new StepRecovery('click the button that creates the issue');
    attempt(recovery, '- button "Create Issue"', click('Create Issue'));
    attempt(recovery, '- heading "Issue #3"\n- button "New Issue"', click('New Issue'));
    expect(attempt(recovery, '- button "Create Issue"\n- textbox "Title"', click('Create Issue'))).toContain('refused:');
  });

  it('is refused when the page did not move', () => {
    const recovery = new StepRecovery('save the settings');
    attempt(recovery, '- button "Save"', click('Save'));
    expect(attempt(recovery, '- button "Save"', click('Save'))).toContain('refused:');
  });

  it('stays refused after a refusal, until the page moves', () => {
    const recovery = new StepRecovery('save the settings');
    attempt(recovery, '- button "Save"', click('Save'));
    expect(attempt(recovery, '- button "Save"', click('Save'))).toContain('refused:');
    expect(attempt(recovery, '- button "Save"', click('Save'))).toContain('refused:');
  });

  it('is refused for an earlier commit after a different one, even on a moved page', () => {
    const recovery = new StepRecovery('page through the wizard');
    attempt(recovery, tour(1), click('Next'));
    attempt(recovery, tour(2), click('Back'));
    expect(attempt(recovery, tour(1), click('Next'))).toContain('refused:');
  });

  it('is not closed by a failed judgment re-observing in between', () => {
    // A judgment changes nothing, so it is not an action between the two: the
    // executor re-observes the page after a failed one, and the next "Next"
    // is decided on that page.
    const recovery = new StepRecovery('click "Next" until the tour shows its last step');
    attempt(recovery, tour(1), click('Next'));
    recovery.observe(tour(2));
    expect(attempt(recovery, tour(2), click('Next'))).toBeUndefined();
  });
});
