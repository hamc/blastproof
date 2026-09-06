import { describe, expect, it } from 'vitest';
import { StepRecovery } from '../src/runner/recovery.js';
import type { AgentAction } from '../src/llm/schemas.js';

const CLICK: AgentAction = { action: 'click', target: { role: 'button', name: 'Save' }, reasoning: 'r' };

describe('StepRecovery.acted (spec agentic-execution: a step closes on what was done)', () => {
  it('is false on a fresh step', () => {
    expect(new StepRecovery('fill the note field').acted).toBe(false);
  });

  it('is true once an action has been recorded', () => {
    const recovery = new StepRecovery('save the note');
    recovery.record(CLICK, 'click button "Save"', 'ok: clicked');
    expect(recovery.acted).toBe(true);
  });

  it('is not moved by observing a snapshot', () => {
    // Being shown a page is not doing something to it. This is the distinction
    // the rule rests on: a step that only ever looked accomplished nothing.
    const recovery = new StepRecovery('save the note');
    recovery.observe('- button "Save"');
    recovery.observe('- button "Save"');
    expect(recovery.acted).toBe(false);
  });
});
