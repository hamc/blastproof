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
import { formatSpendLine } from '../src/report/score.js';

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
  it('is steps times (the iteration ceiling, the retry budget, and the lesser of the two)', () => {
    // One test, 3 steps, N=15, R=3: 3 * (15 + 3 + min(15,3)) = 3 * 21 = 63.
    const ceiling = estimateMaxModelCalls([{ steps: ['a', 'b', 'c'] }], 15, 3);
    expect(ceiling).toBe(63);
  });

  it('counts setup steps alongside main steps', () => {
    const ceiling = estimateMaxModelCalls([{ setup: ['sign in'], steps: ['a', 'b'] }], 10, 3);
    // 3 total steps * (10 + 3 + min(10,3)) = 3 * 16 = 48.
    expect(ceiling).toBe(48);
  });

  it('sums across every test in the selection', () => {
    const ceiling = estimateMaxModelCalls(
      [{ steps: ['a'] }, { steps: ['b', 'c'] }],
      5,
      2,
    );
    // 3 total steps * (5 + 2 + min(5,2)) = 3 * 9 = 27.
    expect(ceiling).toBe(27);
  });

  it('is zero for an empty selection', () => {
    expect(estimateMaxModelCalls([], 15, 3)).toBe(0);
  });

  it('grows with the retry budget, not just the iteration cap', () => {
    // Same iteration cap, only the retry budget differs.
    const low = estimateMaxModelCalls([{ steps: ['a'] }], 15, 1);
    const high = estimateMaxModelCalls([{ steps: ['a'] }], 15, 20);
    expect(high).toBeGreaterThan(low);
    // N=15: low = 15+1+1 = 17, high = 15+20+15 = 50. The gap widened from 19 to
    // 33 when a failing assert began costing a re-judgment too (design D3).
    expect(high - low).toBe(33);
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
      routes: [],
      auth: true, // the parser's default; a fixture that omits it is not a real test file
    };

    const fakePage = {
      goto: async () => {},
      screenshot: async () => {},
      // Settles immediately: this file's tests are about budget accounting,
      // not settling timing (trustworthy-verdicts design D2 — required, not
      // optional, so every PageLike double must still provide it).
      waitForLoadState: async () => {},
      // `waitForSettled` reads the URL before and after settling to decide
      // whether a navigation started; a double without it fails the step
      // before the brain is ever called, which reads as "zero calls made".
      url: () => 'http://localhost:4173/',
    } as unknown as PageLike;

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
    // Tight, not just sufficient: exactly N + R + min(N, R) for one step.
    // The third term is the re-judgment a failed assertion now triggers before
    // control returns to the model (design D3, trustworthy-verdicts), so each
    // failing assert costs three calls rather than two:
    //   2 malformed nextAction calls (R - N, spending retries only)
    // + 3 iterations x (1 nextAction + 2 judge)
    // = 11, which is 3 + 5 + min(3, 5).
    expect(actualCalls).toBe(N + R + Math.min(N, R));
    expect(ceiling).toBe(N + R + Math.min(N, R));
  });
});

// --- what a run spent ---------------------------------------------------------
//
// The counts existed and were discarded (#27). An evaluator sizing a PR gate had
// to ask the provider what a run cost, because the only figure blastproof
// volunteered was `--dry-run`'s worst case — measured at 105 against 13 calls
// actually spent for the same selection.

describe('RunBudget.spend', () => {
  it('reports the calls and tokens spent', () => {
    const budget = new RunBudget();
    budget.record({ totalTokens: 1539 });
    budget.record({ totalTokens: 1525 });

    expect(budget.spend()).toEqual({
      calls: 2,
      tokens: 3064,
      callsWithUsage: 2,
      maxCalls: undefined,
      maxTokens: undefined,
    });
    expect(formatSpendLine(budget.spend())).toBe('Spent: 2 model call(s), 3064 token(s)');
  });

  it('says token usage is unavailable rather than showing zero', () => {
    // A local provider that reports no usage leaves `tokens` at 0, which is
    // indistinguishable from a run that spent nothing. Printing "0 tokens" there
    // is a false statement about the one thing the line exists to report.
    const budget = new RunBudget();
    budget.record(undefined);
    budget.record({});

    expect(budget.spend().callsWithUsage).toBe(0);
    expect(formatSpendLine(budget.spend())).toBe(
      'Spent: 2 model call(s); token usage not reported by the provider',
    );
  });

  it('says how many calls a partial token figure covers', () => {
    const budget = new RunBudget();
    budget.record({ totalTokens: 100 });
    budget.record(undefined);
    budget.record({ totalTokens: 50 });

    expect(formatSpendLine(budget.spend())).toBe(
      'Spent: 3 model call(s), 150 token(s) (tokens reported by 2 of 3 call(s))',
    );
  });

  it('reports against the configured limits when there are any', () => {
    const budget = new RunBudget({ maxCalls: 500, maxTokens: 200_000 });
    budget.record({ totalTokens: 1539 });

    expect(formatSpendLine(budget.spend())).toBe(
      'Spent: 1 of 500 model call(s), 1539 of 200000 token(s)',
    );
  });

  it('still reports what was spent after the budget stopped the run', () => {
    // The case where the number is least guessable and most needed: a stop says
    // which limit was hit, not what the rest of the picture was.
    const budget = new RunBudget({ maxCalls: 2 });
    budget.record({ totalTokens: 900 });
    budget.record({ totalTokens: 800 });
    expect(() => budget.check()).toThrow(BudgetExhaustedError);

    expect(formatSpendLine(budget.spend())).toBe('Spent: 2 of 2 model call(s), 1700 token(s)');
  });
});
