import { describe, expect, it } from 'vitest';
import { agentActionSchema, assertJudgmentSchema } from '../src/llm/schemas.js';

describe('agentActionSchema', () => {
  it('accepts all supported actions', () => {
    for (const action of ['navigate', 'click', 'fill', 'press', 'select', 'assert', 'done', 'fail']) {
      const result = agentActionSchema.safeParse({ action, reasoning: 'because' });
      expect(result.success, action).toBe(true);
    }
  });

  it('accepts a full click action with target', () => {
    const result = agentActionSchema.safeParse({
      action: 'click',
      target: { role: 'button', name: 'Add to cart' },
      reasoning: 'need to add the item',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown actions', () => {
    expect(agentActionSchema.safeParse({ action: 'hover', reasoning: 'x' }).success).toBe(false);
  });

  it('requires reasoning', () => {
    expect(agentActionSchema.safeParse({ action: 'done' }).success).toBe(false);
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
