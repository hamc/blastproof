import { describe, expect, it } from 'vitest';
import { agentActionSchema, assertJudgmentSchema, parseAgentAction } from '../src/llm/schemas.js';

describe('agentActionSchema', () => {
  /** Absence on the wire is `null`, and every key is present (design D1). */
  const absent = { target: null, value: null, expectation: null };

  it('accepts all supported actions', () => {
    for (const action of ['navigate', 'click', 'fill', 'press', 'select', 'assert', 'done', 'fail']) {
      const result = agentActionSchema.safeParse({ action, reasoning: 'because', ...absent });
      expect(result.success, action).toBe(true);
    }
  });

  it('accepts a full click action with target', () => {
    const result = agentActionSchema.safeParse({
      action: 'click',
      target: { role: 'button', name: 'Add to cart', text: null },
      reasoning: 'need to add the item',
      value: null,
      expectation: null,
    });
    expect(result.success).toBe(true);
  });

  it('turns an absent value into undefined, so no consumer sees the difference', () => {
    const result = agentActionSchema.safeParse({ action: 'done', reasoning: 'finished', ...absent });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.target).toBeUndefined();
    expect(result.data.value).toBeUndefined();
    expect(result.data.expectation).toBeUndefined();
  });

  it('requires the key to be present, which is the whole point and a real tightening', () => {
    // A strict validator refuses a schema whose keys can be omitted, so absence
    // is now spelled `null` rather than left out. The cost is here: a provider
    // that omits the key sends something this rejects, where it used to pass.
    // That counts as a failed attempt and is retried — visible, not silent.
    expect(agentActionSchema.safeParse({ action: 'done', reasoning: 'x' }).success).toBe(false);
  });

  it('accepts the shape it has already transformed, so the second parse agrees', () => {
    // `generateObject` parses once and hands back the transformed object; the
    // guard in brain.ts parses that. Feeding it back into the wire schema
    // rejected the model's own valid answer as `Required`, which is what this
    // separation exists to prevent.
    const wire = agentActionSchema.safeParse({
      action: 'click',
      target: { role: 'button', name: 'Save', text: null },
      reasoning: 'save it',
      value: null,
      expectation: null,
    });
    expect(wire.success).toBe(true);
    if (!wire.success) return;
    const guarded = parseAgentAction(wire.data);
    expect(guarded.success).toBe(true);
    expect(guarded.success && guarded.data.target?.name).toBe('Save');
  });

  it('still rejects an action the model invented', () => {
    expect(parseAgentAction({ action: 'explode', reasoning: 'x' }).success).toBe(false);
  });

  it('rejects unknown actions', () => {
    expect(agentActionSchema.safeParse({ action: 'hover', reasoning: 'x', ...absent }).success).toBe(
      false,
    );
  });

  it('requires reasoning', () => {
    expect(agentActionSchema.safeParse({ action: 'done', ...absent }).success).toBe(false);
  });
});

describe('assertJudgmentSchema', () => {
  it('accepts a pass judgment', () => {
    expect(assertJudgmentSchema.safeParse({ pass: true, reason: 'total shows $80' }).success).toBe(true);
  });

  it('rejects missing reason', () => {
    expect(assertJudgmentSchema.safeParse({ pass: false }).success).toBe(false);
  });
});
