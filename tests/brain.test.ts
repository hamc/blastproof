import { describe, expect, it } from 'vitest';
import type { LanguageModel } from 'ai';
import { createBrain, MalformedModelOutputError, type GenerateObjectFn } from '../src/llm/brain.js';
import { agentSystemPrompt, agentUserPrompt, assertUserPrompt } from '../src/llm/prompts.js';

const fakeModel = { provider: 'test', modelId: 'test-model' } as unknown as LanguageModel;

function stubGenerate(object: unknown, captured?: { options?: unknown }): GenerateObjectFn {
  return async (options) => {
    if (captured) captured.options = options;
    return { object };
  };
}

describe('prompts', () => {
  it('system prompt forbids selectors and batches', () => {
    const prompt = agentSystemPrompt();
    expect(prompt).toContain('ONE action');
    expect(prompt).toContain('Never invent CSS selectors');
  });

  it('user prompt includes step, snapshot, last result and budget', () => {
    const prompt = agentUserPrompt({
      step: 'add item to cart',
      snapshot: '- button "Add to cart"',
      lastResult: 'error: element not found',
      retriesLeft: 2,
      iterationsLeft: 9,
    });
    expect(prompt).toContain('add item to cart');
    expect(prompt).toContain('- button "Add to cart"');
    expect(prompt).toContain('error: element not found');
    expect(prompt).toContain('2 failed attempts left');
  });

  it('assert user prompt includes expectation and snapshot', () => {
    const prompt = assertUserPrompt('discount applied', '- text "SAVE20"');
    expect(prompt).toContain('discount applied');
    expect(prompt).toContain('- text "SAVE20"');
  });
});

describe('createBrain', () => {
  it('nextAction returns the validated model decision', async () => {
    const captured: { options?: { system?: string; prompt?: string } } = {};
    const brain = createBrain(
      fakeModel,
      stubGenerate({ action: 'click', target: { role: 'button', name: 'Save' }, reasoning: 'save form' }, captured),
    );
    const action = await brain.nextAction({
      step: 'save the form',
      snapshot: '- button "Save"',
      retriesLeft: 3,
      iterationsLeft: 10,
    });
    expect(action.action).toBe('click');
    expect(action.target?.name).toBe('Save');
    expect(captured.options?.system).toContain('QA agent');
    expect(captured.options?.prompt).toContain('save the form');
  });

  it('nextAction throws MalformedModelOutputError on schema-invalid output', async () => {
    const brain = createBrain(fakeModel, stubGenerate({ action: 'explode' }));
    await expect(
      brain.nextAction({ step: 'x', snapshot: '', retriesLeft: 3, iterationsLeft: 10 }),
    ).rejects.toThrow(MalformedModelOutputError);
  });

  it('judge returns the validated judgment', async () => {
    const brain = createBrain(fakeModel, stubGenerate({ pass: false, reason: 'no discount line' }));
    const judgment = await brain.judge('discount applied', '- main: cart');
    expect(judgment.pass).toBe(false);
    expect(judgment.reason).toContain('no discount');
  });
});
