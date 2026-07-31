import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiffError } from '../src/diff.js';

const {
  launchMock,
  getChangedFilesMock,
  createBrainMock,
  createPlannerMock,
  generateForRouteMock,
  executeTestMock,
} = vi.hoisted(() => ({
  launchMock: vi.fn(),
  getChangedFilesMock: vi.fn(),
  createBrainMock: vi.fn(),
  createPlannerMock: vi.fn(),
  generateForRouteMock: vi.fn(),
  executeTestMock: vi.fn(),
}));

vi.mock('playwright', () => ({ chromium: { launch: launchMock } }));

// testCommand's job is composition, not execution: stub the executor so these
// tests are about which phases run and how their outcomes combine.
vi.mock('../src/runner/executor.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/runner/executor.js')>();
  return { ...original, executeTest: executeTestMock };
});

vi.mock('../src/diff.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/diff.js')>();
  return { ...original, getChangedFiles: getChangedFilesMock };
});

vi.mock('../src/llm/brain.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/llm/brain.js')>();
  return { ...original, createBrain: createBrainMock, createPlanner: createPlannerMock };
});

vi.mock('../src/planner.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/planner.js')>();
  return { ...original, generateForRoute: generateForRouteMock };
});

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from '../src/commands/run.js';
import { testCommand } from '../src/commands/test.js';
import { PlannerError } from '../src/planner.js';

const CART_TEST = `summary: Cart discount
priority: P0
tags: [cart]
routes: ["/cart"]
steps:
  - apply a discount
`;

const DRAFT = {
  summary: 'Settings page loads',
  steps: ['open settings', 'check the heading'],
  priority: 'P1' as const,
  tags: ['settings'],
};

let dir: string;
let logs: string[];
let errors: string[];

const out = (): string => logs.join('\n');
const errOut = (): string => errors.join('\n');

function fakeBrowser(): { close: () => Promise<void> } {
  const page = { setDefaultTimeout: () => {} };
  const context = { newPage: async () => page, close: async () => {} };
  return { newContext: async () => context, close: async () => {} } as unknown as {
    close: () => Promise<void>;
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-test-'));
  logs = [];
  errors = [];
  launchMock.mockReset();
  getChangedFilesMock.mockReset();
  createBrainMock.mockReset();
  createPlannerMock.mockReset();
  generateForRouteMock.mockReset();
  executeTestMock.mockReset();

  launchMock.mockResolvedValue(fakeBrowser());
  // Preflight probes the provider and base_url with plain `fetch`; stubbed so
  // these tests never depend on real network or a running app (spec preflight).
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
  createBrainMock.mockReturnValue({ nextAction: vi.fn(), judge: vi.fn() });
  executeTestMock.mockImplementation(async (_page: unknown, test: { path: string; summary: string; priority: string; tags: string[] }) => ({
    file: test.path,
    summary: test.summary,
    priority: test.priority,
    tags: test.tags,
    status: 'passed' as const,
    steps: [],
    durationMs: 1000,
  }));
  createPlannerMock.mockReturnValue({ planTest: vi.fn() });
  generateForRouteMock.mockImplementation(async (_p: unknown, options: { route: string }) => ({
    ...DRAFT,
    routes: [options.route],
  }));
  process.env.BLASTPROOF_TEST_KEY = 'test-key';

  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.BLASTPROOF_TEST_KEY;
  await rm(dir, { recursive: true, force: true });
});

async function writeProject(tests: Record<string, string> = {}): Promise<void> {
  const config = [
    'base_url: http://localhost:4173',
    'llm:',
    '  provider: anthropic',
    '  api_key_env: BLASTPROOF_TEST_KEY',
    'routes:',
    '  "src/cart/**": ["/cart"]',
    '  "src/settings/**": ["/settings"]',
    '',
  ].join('\n');
  await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
  await writeFile(path.join(dir, '.blastproof', 'config.yaml'), config);
  for (const [name, content] of Object.entries(tests)) {
    await writeFile(path.join(dir, '.blastproof', 'tests', name), content);
  }
}

const testsDir = (): string => path.join(dir, '.blastproof', 'tests');

describe('testCommand', () => {
  it('runs covered routes and drafts the uncovered ones', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    // /cart is covered by cart.yaml; /settings is not.
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts', 'src/settings/flags.ts']);

    const code = await testCommand({ cwd: dir });

    expect(code).toBe(EXIT_OK);
    expect(generateForRouteMock).toHaveBeenCalledTimes(1);
    expect(generateForRouteMock.mock.calls[0]?.[1]).toMatchObject({ route: '/settings' });
    expect(out()).toContain('Verify: tests covering the affected routes');
    expect(out()).toContain('Draft: affected routes no test covers');
  });

  it('exits 0 and does nothing when the diff affects no mapped route', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockResolvedValue(['docs/guide.md']);

    const code = await testCommand({ cwd: dir });

    expect(code).toBe(EXIT_OK);
    expect(launchMock).not.toHaveBeenCalled();
    expect(generateForRouteMock).not.toHaveBeenCalled();
    expect(out()).toContain('Nothing to generate');
  });

  it('never executes a generated draft', async () => {
    await writeProject();
    getChangedFilesMock.mockResolvedValue(['src/settings/flags.ts']);

    const code = await testCommand({ cwd: dir });

    expect(code).toBe(EXIT_OK);
    // The draft was produced but never handed to the executor, and the score
    // reflects only executed tests — which here is none.
    expect(generateForRouteMock).toHaveBeenCalledTimes(1);
    expect(out()).toContain('Score: 100 (no tests executed)');
    expect(out()).toContain('Drafts are not executed');
  });

  it('previews drafts without touching disk', async () => {
    await writeProject();
    getChangedFilesMock.mockResolvedValue(['src/settings/flags.ts']);

    await testCommand({ cwd: dir });

    expect(await readdir(testsDir())).toEqual([]);
    expect(out()).toContain('summary: Settings page loads');
  });

  it('persists drafts with --write', async () => {
    await writeProject();
    getChangedFilesMock.mockResolvedValue(['src/settings/flags.ts']);

    const code = await testCommand({ cwd: dir, write: true });

    expect(code).toBe(EXIT_OK);
    expect(await readdir(testsDir())).toEqual(['settings.yaml']);
    await expect(readFile(path.join(testsDir(), 'settings.yaml'), 'utf8')).resolves.toContain(
      '# route: /settings',
    );
  });

  it('fails when a draft cannot be generated, even with nothing failing', async () => {
    await writeProject();
    getChangedFilesMock.mockResolvedValue(['src/settings/flags.ts']);
    generateForRouteMock.mockRejectedValue(new PlannerError('Cannot load /settings: timeout'));

    const code = await testCommand({ cwd: dir });

    expect(code).toBe(EXIT_FAILED);
    expect(out()).toContain('/settings: Cannot load /settings: timeout');
  });

  it('exits 2 on a diff error before doing anything else', async () => {
    await writeProject();
    getChangedFilesMock.mockRejectedValue(
      new DiffError("Cannot compute diff: base ref 'nope' does not exist in this repository."),
    );

    const code = await testCommand({ cwd: dir, base: 'nope' });

    expect(code).toBe(EXIT_USAGE);
    expect(errOut()).toContain("base ref 'nope' does not exist");
    expect(generateForRouteMock).not.toHaveBeenCalled();
  });

  it('writes both reports when asked', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockResolvedValue(['docs/guide.md']);

    await testCommand({ cwd: dir, junit: 'junit.xml', html: 'report.html' });

    await expect(readFile(path.join(dir, 'junit.xml'), 'utf8')).resolves.toContain('<testsuite');
    await expect(readFile(path.join(dir, 'report.html'), 'utf8')).resolves.toContain(
      'blastproof report',
    );
  });

  it('passes the base ref through to the diff', async () => {
    await writeProject();
    getChangedFilesMock.mockResolvedValue([]);

    await testCommand({ cwd: dir, base: 'develop' });

    expect(getChangedFilesMock).toHaveBeenCalledWith('develop', dir);
  });
});

describe('testCommand budget (spec run-budget: one budget spans both phases)', () => {
  it('hands the run phase and the plan phase the same budget instance, not one each', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    // /cart is covered (run phase exercises it); /settings is not (plan phase drafts it).
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts', 'src/settings/flags.ts']);

    const code = await testCommand({ cwd: dir, maxLlmCalls: 5 });

    expect(code).toBe(EXIT_OK);
    expect(createBrainMock).toHaveBeenCalled();
    expect(createPlannerMock).toHaveBeenCalled();
    const runPhaseBudget = createBrainMock.mock.calls.at(-1)?.[2];
    const planPhaseBudget = createPlannerMock.mock.calls.at(-1)?.[2];
    expect(runPhaseBudget).toBeDefined();
    // Reference equality, not merely equal limits: a fresh budget with the same
    // configured maximum would pass a looser check but still be two allowances.
    expect(planPhaseBudget).toBe(runPhaseBudget);
  });

  it('does not grant the plan phase a fresh allowance once the run phase has spent the budget', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts', 'src/settings/flags.ts']);
    // Stands in for what the real createBrain wrapper does on every call: spend
    // one unit of the shared budget before the test's outcome is even decided.
    createBrainMock.mockImplementation((_model: unknown, _generate: unknown, budget: { record: (u: unknown) => void }) => {
      budget?.record(undefined);
      return { nextAction: vi.fn(), judge: vi.fn() };
    });

    const code = await testCommand({ cwd: dir, maxLlmCalls: 1 });

    expect(code).toBe(EXIT_OK);
    const planPhaseBudget = createPlannerMock.mock.calls.at(-1)?.[2] as { check: () => void };
    expect(planPhaseBudget).toBeDefined();
    // The one call the run phase spent already exhausted the shared allowance —
    // a fresh budget handed to `plan` would not throw here.
    expect(() => planPhaseBudget.check()).toThrow(/model call budget exhausted/);
  });
});
