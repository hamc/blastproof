import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetExhaustedError, RunBudget } from '../src/runner/budget.js';

/** The slice of `RunBudget` these tests drive through the mocked `createBrain`. */
type RunBudgetLike = { record(usage: { totalTokens?: number } | undefined): void };

const { launchMock, createBrainMock, executeTestMock } = vi.hoisted(() => ({
  launchMock: vi.fn(),
  createBrainMock: vi.fn(),
  executeTestMock: vi.fn(),
}));

vi.mock('playwright', () => ({ chromium: { launch: launchMock } }));

// A real RunBudget is exercised through createBrain in production; these tests
// drive the same BudgetExhaustedError the wrapper would throw, so runCommand's
// handling of it — not the wrapper itself (covered in brain.test.ts) — is what's
// under test here.
vi.mock('../src/runner/executor.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/runner/executor.js')>();
  return { ...original, executeTest: executeTestMock };
});

vi.mock('../src/llm/brain.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/llm/brain.js')>();
  return { ...original, createBrain: createBrainMock };
});

import { EXIT_FAILED, runCommand } from '../src/commands/run.js';

const CONFIG = [
  'base_url: http://localhost:4173',
  'llm:',
  '  provider: anthropic',
  '  api_key_env: BLASTPROOF_BUDGET_TEST_KEY',
  'budget:',
  '  max_llm_calls: 5',
  '',
].join('\n');

const TEST_A = 'summary: Test A\npriority: P0\nsteps:\n  - do a\n';
const TEST_B = 'summary: Test B\npriority: P0\nsteps:\n  - do b\n';
const TEST_C = 'summary: Test C\npriority: P0\nsteps:\n  - do c\n';

let dir: string;
let logs: string[];

const out = (): string => logs.join('\n');

function browserDouble(): unknown {
  return {
    newContext: async () => ({
      newPage: async () => ({ setDefaultTimeout: () => {} }),
      storageState: async () => ({ cookies: [], origins: [] }),
      close: async () => {},
    }),
    close: async () => {},
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-runbudget-'));
  logs = [];
  launchMock.mockReset();
  createBrainMock.mockReset();
  executeTestMock.mockReset();

  launchMock.mockResolvedValue(browserDouble());
  // Preflight probes the provider and base_url with plain `fetch`; stubbed so
  // these tests never depend on real network or a running app (spec preflight).
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
  createBrainMock.mockReturnValue({ nextAction: vi.fn(), judge: vi.fn() });
  process.env.BLASTPROOF_BUDGET_TEST_KEY = 'key';

  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.BLASTPROOF_BUDGET_TEST_KEY;
  await rm(dir, { recursive: true, force: true });
});

async function writeProject(tests: Record<string, string>): Promise<void> {
  await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
  await writeFile(path.join(dir, '.blastproof', 'config.yaml'), CONFIG);
  for (const [name, content] of Object.entries(tests)) {
    await writeFile(path.join(dir, '.blastproof', 'tests', name), content);
  }
}

function passingResult(test: { path: string; summary: string; priority: string; tags: string[] }): {
  file: string;
  summary: string;
  priority: string;
  tags: string[];
  status: 'passed';
  steps: never[];
  durationMs: number;
} {
  return {
    file: test.path,
    summary: test.summary,
    priority: test.priority,
    tags: test.tags,
    status: 'passed',
    steps: [],
    durationMs: 10,
  };
}

describe('runCommand budget exhaustion (design D3/D4, spec run-budget)', () => {
  it('stops the run, marks the remaining tests not run, and exits 1 even though all executed tests passed', async () => {
    await writeProject({ 'a.yaml': TEST_A, 'b.yaml': TEST_B, 'c.yaml': TEST_C });
    executeTestMock.mockImplementation(
      async (_page: unknown, test: { path: string; summary: string; priority: string; tags: string[] }) => {
        if (test.summary === 'Test B') {
          throw new BudgetExhaustedError('calls', 5, 5);
        }
        return passingResult(test);
      },
    );

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_FAILED);
    expect(out()).toContain('Run incomplete');
    expect(out()).toContain('model call budget exhausted');
    // Test A ran and passed; Test B was interrupted; Test C never started.
    expect(out()).toContain('Test A');
    expect(out()).toMatch(/NOT RUN\s+P0\s+Test B/);
    expect(out()).toMatch(/NOT RUN\s+P0\s+Test C/);
  });

  it('does not let --min-score rescue an incomplete run', async () => {
    await writeProject({ 'a.yaml': TEST_A, 'b.yaml': TEST_B });
    executeTestMock.mockImplementation(
      async (_page: unknown, test: { path: string; summary: string; priority: string; tags: string[] }) => {
        if (test.summary === 'Test B') throw new BudgetExhaustedError('calls', 5, 5);
        return passingResult(test);
      },
    );

    // Test A alone would score 100 and satisfy any threshold.
    const code = await runCommand({ cwd: dir, tags: [], minScore: 1 });

    expect(code).toBe(EXIT_FAILED);
  });

  it('excludes the not-run test from the score, rather than counting it as a failure', async () => {
    await writeProject({ 'a.yaml': TEST_A, 'b.yaml': TEST_B });
    executeTestMock.mockImplementation(
      async (_page: unknown, test: { path: string; summary: string; priority: string; tags: string[] }) => {
        if (test.summary === 'Test B') throw new BudgetExhaustedError('calls', 5, 5);
        return passingResult(test);
      },
    );

    await runCommand({ cwd: dir, tags: [] });

    // If Test B counted as a failure the score would be 0, not 100.
    expect(out()).toContain('Score over executed tests: 100');
  });

  it('wires the resolved budget (flag > config) into createBrain for every test', async () => {
    await writeProject({ 'a.yaml': TEST_A });
    executeTestMock.mockImplementation(
      async (_page: unknown, test: { path: string; summary: string; priority: string; tags: string[] }) =>
        passingResult(test),
    );

    // Config says 5; the flag tightens it to 1.
    await runCommand({ cwd: dir, tags: [], maxLlmCalls: 1 });

    expect(createBrainMock).toHaveBeenCalled();
    const budget = createBrainMock.mock.calls.at(-1)?.[2];
    expect(budget).toBeDefined();
    budget.check(); // 0 calls recorded yet: must not throw
    budget.record(undefined);
    expect(() => budget.check()).toThrow(/model call budget exhausted/);
  });

  it('marks every selected test not run when the budget is already exhausted during login', async () => {
    const authConfig = [
      'base_url: http://localhost:4173',
      'llm:',
      '  provider: anthropic',
      '  api_key_env: BLASTPROOF_BUDGET_TEST_KEY',
      'auth:',
      '  steps:',
      '    - sign in',
      'budget:',
      '  max_llm_calls: 5',
      '',
    ].join('\n');
    await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
    await writeFile(path.join(dir, '.blastproof', 'config.yaml'), authConfig);
    await writeFile(path.join(dir, '.blastproof', 'tests', 'a.yaml'), TEST_A);

    executeTestMock.mockImplementation(async () => {
      throw new BudgetExhaustedError('calls', 5, 5);
    });

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_FAILED);
    expect(out()).toContain('Run incomplete');
    expect(out()).toMatch(/NOT RUN\s+P0\s+Test A/);
  });
});

describe('runCommand reports what it spent (#27)', () => {
  it('prints the spend for a run that owns its budget', async () => {
    await writeProject({ 'a.yaml': TEST_A });
    executeTestMock.mockImplementation(async (_page, test) => passingResult(test));
    createBrainMock.mockImplementation((_model: unknown, _mask: unknown, budget: RunBudgetLike) => {
      budget.record({ totalTokens: 1200 });
      budget.record({ totalTokens: 800 });
      return { nextAction: vi.fn(), judge: vi.fn() };
    });

    await runCommand({ cwd: dir, tags: [] });

    expect(out()).toContain('Spent: 2 of 5 model call(s), 2000 token(s)');
  });

  it('does not print the spend when a composing caller owns the budget', async () => {
    // `test` hands one budget to both phases on purpose. Reporting at the point
    // of use rather than the point of ownership would print the running total
    // twice, the second line silently including the first.
    await writeProject({ 'a.yaml': TEST_A });
    executeTestMock.mockImplementation(async (_page, test) => passingResult(test));
    const shared = new RunBudget();
    createBrainMock.mockImplementation((_model: unknown, _mask: unknown, budget: RunBudgetLike) => {
      budget.record({ totalTokens: 1200 });
      return { nextAction: vi.fn(), judge: vi.fn() };
    });

    await runCommand({ cwd: dir, tags: [], budget: shared });

    expect(out()).not.toContain('Spent:');
    expect(shared.spend().calls).toBe(1);
  });

  it('reports the spend of a run its budget stopped', async () => {
    await writeProject({ 'a.yaml': TEST_A, 'b.yaml': TEST_B });
    createBrainMock.mockImplementation((_model: unknown, _mask: unknown, budget: RunBudgetLike) => {
      budget.record({ totalTokens: 900 });
      return { nextAction: vi.fn(), judge: vi.fn() };
    });
    executeTestMock
      .mockImplementationOnce(async (_page: unknown, test: never) => passingResult(test))
      .mockRejectedValueOnce(new BudgetExhaustedError('calls', 5, 5));

    await runCommand({ cwd: dir, tags: [] });

    expect(out()).toContain('Run incomplete');
    expect(out()).toContain('Spent:');
  });
});

describe('runCommand concurrency (#2)', () => {
  it('runs tests one at a time by default, streaming their output', async () => {
    // The default must not change what an existing user sees. Tests are
    // journeys against one live application, and only the person who wrote
    // them knows whether two can run at once (design tests-in-parallel, D1).
    await writeProject({ 'a.yaml': TEST_A, 'b.yaml': TEST_B });
    let inFlight = 0;
    let peak = 0;
    executeTestMock.mockImplementation(async (_page: unknown, test: never) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return passingResult(test);
    });

    await runCommand({ cwd: dir, tags: [] });

    expect(peak).toBe(1);
  });

  it('runs several at once when asked, and reports in selection order', async () => {
    await writeProject({ 'a.yaml': TEST_A, 'b.yaml': TEST_B, 'c.yaml': TEST_C });
    let peak = 0;
    let inFlight = 0;
    // B finishes last; the summary must still list A, B, C.
    const delays: Record<string, number> = { 'Test A': 5, 'Test B': 40, 'Test C': 5 };
    executeTestMock.mockImplementation(async (_page: unknown, test: never) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, delays[(test as { summary: string }).summary] ?? 5));
      inFlight--;
      return passingResult(test);
    });

    await runCommand({ cwd: dir, tags: [], concurrency: 3 });

    expect(peak).toBe(3);
    const summary = out().slice(out().indexOf('--- Summary'));
    expect(summary.indexOf('Test A')).toBeLessThan(summary.indexOf('Test B'));
    expect(summary.indexOf('Test B')).toBeLessThan(summary.indexOf('Test C'));
  });

  it('keeps each test\'s transcript contiguous when running concurrently', async () => {
    await writeProject({ 'a.yaml': TEST_A, 'b.yaml': TEST_B });
    executeTestMock.mockImplementation(async (_page: unknown, test: never, options: never) => {
      const { summary } = test as { summary: string };
      const emit = (options as { onEvent: (e: unknown) => void }).onEvent;
      emit({ type: 'step-start', index: 0, total: 1, step: `${summary} step one`, setup: false });
      await new Promise((resolve) => setTimeout(resolve, summary === 'Test A' ? 30 : 1));
      emit({ type: 'step-start', index: 1, total: 2, step: `${summary} step two`, setup: false });
      return passingResult(test);
    });

    await runCommand({ cwd: dir, tags: [], concurrency: 2 });

    // Contiguity, not ordering: B finishes first so its block prints first,
    // which is fine. What must not happen is another test's line landing
    // between two of A's.
    const text = out();
    const between = text.slice(
      text.indexOf('Test A step one'),
      text.indexOf('Test A step two'),
    );
    expect(between).not.toContain('Test B');
    expect(text).toContain('Test A step two');
  });

  it('starts no further test once the budget has stopped the run', async () => {
    await writeProject({ 'a.yaml': TEST_A, 'b.yaml': TEST_B, 'c.yaml': TEST_C });
    const started: string[] = [];
    executeTestMock.mockImplementation(async (_page: unknown, test: never) => {
      const { summary } = test as { summary: string };
      started.push(summary);
      if (summary === 'Test A') throw new BudgetExhaustedError('calls', 5, 5);
      return passingResult(test);
    });

    await runCommand({ cwd: dir, tags: [] });

    // Only the test that hit the limit ever ran; the guarantee is held by the
    // loop, not inherited from the budget happening to refuse the next check.
    expect(started).toEqual(['Test A']);
    expect(out()).toMatch(/NOT RUN\s+P0\s+Test B/);
    expect(out()).toMatch(/NOT RUN\s+P0\s+Test C/);
  });

  it('takes the flag over the configured value', async () => {
    await writeProject({ 'a.yaml': TEST_A, 'b.yaml': TEST_B });
    await writeFile(
      path.join(dir, '.blastproof', 'config.yaml'),
      `${CONFIG}concurrency: 1\n`,
    );
    let peak = 0;
    let inFlight = 0;
    executeTestMock.mockImplementation(async (_page: unknown, test: never) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return passingResult(test);
    });

    await runCommand({ cwd: dir, tags: [], concurrency: 2 });

    expect(peak).toBe(2);
  });
});
