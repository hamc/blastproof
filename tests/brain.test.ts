import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import {
  createBrain,
  createPlanner,
  MalformedModelOutputError,
  type GenerateObjectFn,
} from '../src/llm/brain.js';
import {
  agentSystemPrompt,
  agentUserPrompt,
  assertUserPrompt,
  plannerSystemPrompt,
  plannerUserPrompt,
} from '../src/llm/prompts.js';
import { BudgetExhaustedError, RunBudget } from '../src/runner/budget.js';

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

  it('system prompt maps an already-satisfied step to done, not fail', () => {
    // A dogfood run failed a passing login because the agent read "already
    // submitted" as "impossible to accomplish" and returned fail.
    const prompt = agentSystemPrompt();
    expect(prompt).toContain('"Already true" is done, never failure');
    expect(prompt).toContain('Never return "fail" because the work appears to have been done already');
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
      new RunBudget(),
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
    const brain = createBrain(fakeModel, stubGenerate({ action: 'explode' }), new RunBudget());
    await expect(
      brain.nextAction({ step: 'x', snapshot: '', retriesLeft: 3, iterationsLeft: 10 }),
    ).rejects.toThrow(MalformedModelOutputError);
  });

  it('judge returns the validated judgment', async () => {
    const brain = createBrain(
      fakeModel,
      stubGenerate({ pass: false, reason: 'no discount line' }),
      new RunBudget(),
    );
    const judgment = await brain.judge('discount applied', '- main: cart');
    expect(judgment.pass).toBe(false);
    expect(judgment.reason).toContain('no discount');
  });
});

describe('createBrain budget enforcement (design D2)', () => {
  it('counts a nextAction call against the budget', async () => {
    const budget = new RunBudget({ maxCalls: 1 });
    const brain = createBrain(
      fakeModel,
      stubGenerate({ action: 'done', reasoning: 'ok' }),
      budget,
    );
    await brain.nextAction({ step: 'x', snapshot: '', retriesLeft: 3, iterationsLeft: 10 });
    expect(budget.callCount).toBe(1);
    await expect(
      brain.nextAction({ step: 'x', snapshot: '', retriesLeft: 3, iterationsLeft: 10 }),
    ).rejects.toThrow(BudgetExhaustedError);
  });

  it('counts a judge call against the budget', async () => {
    const budget = new RunBudget({ maxCalls: 1 });
    const brain = createBrain(fakeModel, stubGenerate({ pass: true, reason: 'ok' }), budget);
    await brain.judge('expectation', 'snapshot');
    expect(budget.callCount).toBe(1);
  });

  it('records tokens from the AI SDK usage the wrapper previously discarded', async () => {
    const budget = new RunBudget({ maxTokens: 100 });
    const generate: GenerateObjectFn = async () => ({
      object: { action: 'done', reasoning: 'ok' },
      usage: { totalTokens: 60 },
    });
    const brain = createBrain(fakeModel, generate, budget);
    await brain.nextAction({ step: 'x', snapshot: '', retriesLeft: 3, iterationsLeft: 10 });
    expect(budget.tokenCount).toBe(60);
    await brain.nextAction({ step: 'x', snapshot: '', retriesLeft: 3, iterationsLeft: 10 });
    expect(budget.tokenCount).toBe(120);
    // The second call already crossed 100, so the third is never issued.
    const generateSpy = vi.fn(generate);
    const brain2 = createBrain(fakeModel, generateSpy, budget);
    await expect(
      brain2.nextAction({ step: 'x', snapshot: '', retriesLeft: 3, iterationsLeft: 10 }),
    ).rejects.toThrow(BudgetExhaustedError);
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('never issues a call that would exceed the budget (spec: not issued and rejected)', async () => {
    const budget = new RunBudget({ maxCalls: 0 });
    const generateSpy = vi.fn(stubGenerate({ action: 'done', reasoning: 'ok' }));
    const brain = createBrain(fakeModel, generateSpy, budget);
    await expect(
      brain.nextAction({ step: 'x', snapshot: '', retriesLeft: 3, iterationsLeft: 10 }),
    ).rejects.toThrow(BudgetExhaustedError);
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('still records a call whose output later fails schema validation', async () => {
    const budget = new RunBudget({ maxCalls: 5 });
    const brain = createBrain(fakeModel, stubGenerate({ action: 'explode' }), budget);
    await expect(
      brain.nextAction({ step: 'x', snapshot: '', retriesLeft: 3, iterationsLeft: 10 }),
    ).rejects.toThrow(MalformedModelOutputError);
    expect(budget.callCount).toBe(1);
  });

  it('does not bind when the budget carries no configured limits (inert by default)', async () => {
    const brain = createBrain(fakeModel, stubGenerate({ action: 'done', reasoning: 'ok' }), new RunBudget());
    await expect(
      brain.nextAction({ step: 'x', snapshot: '', retriesLeft: 3, iterationsLeft: 10 }),
    ).resolves.toMatchObject({ action: 'done' });
  });
});

describe('createPlanner budget enforcement (design D2)', () => {
  it('counts a planTest call too — a budget that missed the planner would repeat #15', async () => {
    const budget = new RunBudget({ maxCalls: 1 });
    const planner = createPlanner(
      fakeModel,
      stubGenerate({
        summary: 'a test',
        steps: ['do a thing'],
        priority: 'P1',
        tags: [],
      }),
      budget,
    );
    await planner.planTest({ route: '/x', snapshot: '', changedFiles: [] });
    expect(budget.callCount).toBe(1);
    await expect(
      planner.planTest({ route: '/x', snapshot: '', changedFiles: [] }),
    ).rejects.toThrow(BudgetExhaustedError);
  });
});

describe('planner prompts', () => {
  it('system prompt forbids selectors and invented controls, and requires placeholders', () => {
    const prompt = plannerSystemPrompt();
    expect(prompt).toContain('Never invent buttons');
    expect(prompt).toContain('Never write CSS selectors');
    expect(prompt).toContain('{{env.TEST_PASSWORD}}');
  });

  it('user prompt carries route, snapshot and changed files', () => {
    const prompt = plannerUserPrompt({
      route: '/cart',
      snapshot: '- button "Apply discount"',
      changedFiles: ['src/cart/discount.ts', 'src/cart/total.ts'],
    });
    expect(prompt).toContain('/cart');
    expect(prompt).toContain('- button "Apply discount"');
    expect(prompt).toContain('src/cart/discount.ts');
    expect(prompt).toContain('src/cart/total.ts');
  });

  it('user prompt handles an empty changed-file set', () => {
    const prompt = plannerUserPrompt({ route: '/login', snapshot: '- form', changedFiles: [] });
    expect(prompt).toContain('main user journey');
  });
});

describe('createPlanner', () => {
  it('planTest returns the validated draft and uses the planner prompts', async () => {
    const captured: { options?: { system?: string; prompt?: string } } = {};
    const planner = createPlanner(
      fakeModel,
      stubGenerate(
        {
          summary: 'Applying a discount updates the total',
          steps: ['open the cart', 'apply the discount code', 'check the total drops'],
          priority: 'P0',
          tags: ['cart'],
        },
        captured,
      ),
      new RunBudget(),
    );

    const draft = await planner.planTest({
      route: '/cart',
      snapshot: '- button "Apply discount"',
      changedFiles: ['src/cart/discount.ts'],
    });

    expect(draft.summary).toContain('discount');
    expect(draft.steps).toHaveLength(3);
    expect(draft.priority).toBe('P0');
    expect(captured.options?.system).toContain('QA engineer');
    expect(captured.options?.prompt).toContain('src/cart/discount.ts');
  });

  it('planTest throws MalformedModelOutputError on schema-invalid output', async () => {
    const planner = createPlanner(fakeModel, stubGenerate({ summary: 'no steps', steps: [] }), new RunBudget());
    await expect(
      planner.planTest({ route: '/cart', snapshot: '', changedFiles: [] }),
    ).rejects.toThrow(MalformedModelOutputError);
  });
});
