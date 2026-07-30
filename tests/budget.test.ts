import { describe, expect, it } from 'vitest';
import type { AgentBrain } from '../src/llm/brain.js';
import type { AgentAction, AssertJudgment } from '../src/llm/schemas.js';
import {
  BudgetExhaustedError,
  estimateMaxModelCalls,
  RunBudget,
} from '../src/runner/budget.js';
import { executeTest } from '../src/runner/executor.js';
import type { PageLike } from '../src/runner/actions.js';
import type { TestFile } from '../src/runner/testfile.js';

describe('RunBudget', () => {
  it('never binds when unconfigured', () => {
    const budget = new RunBudget();
    for (let i = 0; i < 1000; i++) {
      expect(() => budget.check()).not.toThrow();
      budget.record({ totalTokens: 1_000_000 });
    }
  });

  it('exhausts the call limit independently of tokens and duration', () => {
    const budget = new RunBudget({ maxCalls: 2 });
    budget.check();
    budget.record(undefined);
    budget.check();
    budget.record(undefined);
    expect(() => budget.check()).toThrow(BudgetExhaustedError);
  });

  it('names the limit and the observed count for an exhausted call budget', () => {
    const budget = new RunBudget({ maxCalls: 1 });
    budget.record(undefined);
    const error = getError(() => budget.check());
    expect(error).toBeInstanceOf(BudgetExhaustedError);
    expect(error.limit).toBe('calls');
    expect(error.observed).toBe(1);
    expect(error.configured).toBe(1);
    expect(error.message).toContain('1 call');
  });

  it('exhausts the token limit independently of calls and duration', () => {
    const budget = new RunBudget({ maxTokens: 100 });
    budget.check();
    budget.record({ totalTokens: 100 });
    const error = getError(() => budget.check());
    expect(error.limit).toBe('tokens');
    expect(error.observed).toBe(100);
    expect(error.configured).toBe(100);
    expect(error.message).toContain('100 token');
  });

  it('exhausts the duration limit independently of calls and tokens', () => {
    let now = 0;
    const budget = new RunBudget({ maxDurationMs: 1000, now: () => now });
    now = 500;
    expect(() => budget.check()).not.toThrow();
    now = 1000;
    const error = getError(() => budget.check());
    expect(error.limit).toBe('duration');
    expect(error.message).toContain('deadline exceeded');
  });

  it('never issues a call that would exceed the budget: check() throws before record()', () => {
    const budget = new RunBudget({ maxCalls: 1 });
    budget.record(undefined);
    expect(() => budget.check()).toThrow(BudgetExhaustedError);
    // callCount is unchanged: the "call" that would have exceeded it was never made.
    expect(budget.callCount).toBe(1);
  });

  it('accepts overshoot on tokens bounded by one call (design risk, documented)', () => {
    const budget = new RunBudget({ maxTokens: 100 });
    budget.check(); // under budget: allowed
    budget.record({ totalTokens: 500 }); // the in-flight call overshoots by 400
    expect(budget.tokenCount).toBe(500);
    expect(() => budget.check()).toThrow(BudgetExhaustedError);
  });
});

function getError(fn: () => void): BudgetExhaustedError {
  try {
    fn();
  } catch (error) {
    if (error instanceof BudgetExhaustedError) return error;
    throw error;
  }
  throw new Error('expected fn to throw');
}

describe('estimateMaxModelCalls', () => {
  it('is steps times (the iteration ceiling plus the retry budget)', () => {
    // One test, 3 steps, N=15, R=3: 3 * (15 + 3) = 54.
    const ceiling = estimateMaxModelCalls([{ steps: ['a', 'b', 'c'] }], 15, 3);
    expect(ceiling).toBe(54);
  });

  it('counts setup steps alongside main steps', () => {
    const ceiling = estimateMaxModelCalls([{ setup: ['sign in'], steps: ['a', 'b'] }], 10, 3);
    // 3 total steps * (10 + 3) = 39.
    expect(ceiling).toBe(39);
  });

  it('sums across every test in the selection', () => {
    const ceiling = estimateMaxModelCalls(
      [{ steps: ['a'] }, { steps: ['b', 'c'] }],
      5,
      2,
    );
    // 3 total steps * (5 + 2) = 21.
    expect(ceiling).toBe(21);
  });

  it('is zero for an empty selection', () => {
    expect(estimateMaxModelCalls([], 15, 3)).toBe(0);
  });

  it('grows with the retry budget, not just the iteration cap', () => {
    // Same iteration cap, only the retry budget differs.
    const low = estimateMaxModelCalls([{ steps: ['a'] }], 15, 1);
    const high = estimateMaxModelCalls([{ steps: ['a'] }], 15, 20);
    expect(high).toBeGreaterThan(low);
    expect(high - low).toBe(19);
  });
});

/**
 * DEF-001 regression: a config with `max_retries_per_step` above the iteration
 * cap is exactly the case the old `2 * maxIterationsPerStep` formula undercounted
 * — QA measured 35 real calls against a reported ceiling of 30 (N=15, R=20; the
 * old formula ignored R entirely). A test that only exercises default config
 * would pass against that broken formula too, so this one deliberately sets
 * R > N and drives the real executor loop adversarially (never `done`, always a
 * failing `assert`, plus malformed responses) to spend as many calls as the loop
 * allows, then checks the ceiling actually bounds what happened — not merely
 * that it looks plausible.
 */
describe('estimateMaxModelCalls bounds the real executor (DEF-001 regression)', () => {
  it('is >= the actual call count when retries exceed the iteration cap', async () => {
    const N = 3; // maxIterationsPerStep
    const R = 5; // maxRetries — deliberately above N, the case that broke the old formula

    let nextActionCalls = 0;
    let judgeCalls = 0;
    const assertAction: AgentAction = { action: 'assert', reasoning: 'check', expectation: 'x' };
    const failingJudgment: AssertJudgment = { pass: false, reason: 'not yet' };

    // Worst-case schedule (see estimateMaxModelCalls's derivation): spend the
    // retry budget that doesn't fit in the iteration cap (R - N) as standalone
    // malformed responses first, then fail every remaining iteration's assert.
    const adversarialBrain: AgentBrain = {
      async nextAction() {
        nextActionCalls++;
        if (nextActionCalls <= R - N) {
          throw new Error('malformed'); // costs a retry unit, no iteration slot
        }
        return assertAction; // costs an iteration slot
      },
      async judge() {
        judgeCalls++;
        return failingJudgment; // costs a retry unit too, on top of the iteration slot
      },
    };

    const test: TestFile = {
      path: '.blastproof/tests/def-001.yaml',
      summary: 'DEF-001 regression',
      steps: ['one step, worst case'],
      priority: 'P1',
      tags: [],
    };

    const fakePage = { goto: async () => {}, screenshot: async () => {} } as unknown as PageLike;

    const result = await executeTest(fakePage, test, {
      brain: adversarialBrain,
      sessionDir: '/tmp',
      baseUrl: 'http://localhost:4173',
      maxRetries: R,
      maxIterationsPerStep: N,
      timeoutMs: 30_000,
      snapshot: async () => 'snapshot',
    });

    // The retry budget is exhausted deliberately: the step is expected to fail.
    expect(result.status).toBe('failed');
    const actualCalls = nextActionCalls + judgeCalls;
    const ceiling = estimateMaxModelCalls([test], N, R);

    expect(ceiling).toBeGreaterThanOrEqual(actualCalls);
    // Tight, not just sufficient: this is exactly N + R for one step, matching
    // the derivation and DEF-001's own measurement (15 + 20 = 35).
    expect(actualCalls).toBe(N + R);
    expect(ceiling).toBe(N + R);
  });
});
