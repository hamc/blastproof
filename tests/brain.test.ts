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
  assertSystemPrompt,
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

  it('assert user prompt includes the step, the expectation and the snapshot', () => {
    const prompt = assertUserPrompt('verify the discount is applied', 'discount applied', '- text "SAVE20"');
    expect(prompt).toContain('verify the discount is applied');
    expect(prompt).toContain('discount applied');
    expect(prompt).toContain('- text "SAVE20"');
  });

  it('assert user prompt presents the step as the question and the expectation as a claim offered in support (design D1)', () => {
    const prompt = assertUserPrompt('verify X', 'my claim', '- snap');
    expect(prompt).toContain('Step under test: verify X');
    expect(prompt).toContain('claim offered in support of the step');
    expect(prompt).toContain('my claim');
  });

  it("assert system prompt says a true-but-irrelevant claim does not establish the step (task 2.2)", () => {
    // Regression for the substitution defect (#31): "the 'Show Archived'
    // checkbox is visible" was true and closed a step whose real assertion
    // had just failed one turn earlier.
    const prompt = assertSystemPrompt();
    expect(prompt).toContain('outcome holds');
    expect(prompt).toMatch(/true.*(irrelevant|not (a substitute|establish)|does not establish)/i);
  });

  it('assert system prompt distinguishes an entered value from a committed one, narrowly (task 3.1/3.2)', () => {
    // Regression for the second observed defect (#31): a project title typed
    // into an unsubmitted "New project" dialog satisfied "visible in the
    // projects list".
    const prompt = assertSystemPrompt();
    expect(prompt).toMatch(/unsubmitted|not-?yet-?submitted|committed/i);
    // Kept narrow (task 3.2): must not become "fail anything uncertain".
    expect(prompt).toMatch(/plainly shows.*pass it|pass it.*plainly/i);
  });

  it("assert system prompt says an action-shaped step is not failed merely because its own named control is gone (the \"submit the login form\" regression)", () => {
    // A third defect, found only against a real model after the first two
    // unit suites went green: anchoring on the step made "submit the login
    // form" unjudgeable exactly when the login succeeded, because succeeding
    // navigates away from the very form the step names. The same model
    // passed an identically-shaped step ("submit the support form") in the
    // same session — the instability this clause is meant to remove.
    const prompt = assertSystemPrompt();
    expect(prompt).toMatch(/names an action|naming an action/i);
    expect(prompt).toMatch(/absence.*normal evidence of success|not evidence the step is unverifiable/i);
    // Kept narrow, symmetric with task 3.2: this must not become "any page
    // change means the step passed" — it still requires a real failure
    // signal to fail, and it does not license passing everything else.
    expect(prompt).toMatch(/error message|validation warning/i);
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
    const judgment = await brain.judge('verify the discount applied', 'discount applied', '- main: cart');
    expect(judgment.pass).toBe(false);
    expect(judgment.reason).toContain('no discount');
  });

  it('judge sends the step, the expectation and the snapshot into the prompt (design D1, task 2.1)', async () => {
    const captured: { options?: { prompt?: string } } = {};
    const brain = createBrain(fakeModel, stubGenerate({ pass: true, reason: 'ok' }, captured), new RunBudget());
    await brain.judge('verify the cart total is $80', 'total shows $80', '- text "$80"');
    expect(captured.options?.prompt).toContain('verify the cart total is $80');
    expect(captured.options?.prompt).toContain('total shows $80');
    expect(captured.options?.prompt).toContain('- text "$80"');
  });
});

describe('what is pinned and what is not (design D1, deterministic-verdicts)', () => {
  it('pins the judgment, because two decisions about one page must agree', async () => {
    const captured: { options?: { temperature?: number } } = {};
    const brain = createBrain(fakeModel, stubGenerate({ pass: true, reason: 'ok' }, captured), new RunBudget());
    await brain.judge('verify the total is $80', 'total shows $80', '- text "$80"');
    expect(captured.options?.temperature).toBe(0);
  });

  it('leaves the action choice free, because that latitude is the self-healing', async () => {
    // Asserting the absence, not just the presence elsewhere: a change that
    // pins every call would fix the flakiness and quietly cost the behaviour
    // the tool is built around, and nothing else would fail.
    const captured: { options?: { temperature?: number } } = {};
    const brain = createBrain(
      fakeModel,
      stubGenerate({ action: 'click', target: { role: 'button', name: 'Save' }, reasoning: 'save' }, captured),
      new RunBudget(),
    );
    await brain.nextAction({ step: 'save', snapshot: '- button "Save"', retriesLeft: 3, iterationsLeft: 10 });
    expect(captured.options).not.toHaveProperty('temperature');
  });

  it('leaves the planner free, because a person reads the draft before it runs', async () => {
    const captured: { options?: { temperature?: number } } = {};
    const planner = createPlanner(
      fakeModel,
      stubGenerate(
        { summary: 'Cart shows the discount', steps: ['navigate to /cart and verify the heading "Your cart" is shown'], priority: 'P1', tags: ['cart'] },
        captured,
      ),
      new RunBudget(),
    );
    await planner.planTest({ route: '/cart', snapshot: '- heading "Your cart"', changedFiles: [] });
    expect(captured.options).not.toHaveProperty('temperature');
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
    await brain.judge('step', 'expectation', 'snapshot');
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
