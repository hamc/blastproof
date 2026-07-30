import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiffError } from '../src/diff.js';
import { BudgetExhaustedError } from '../src/runner/budget.js';

const { launchMock, getChangedFilesMock, createPlannerMock, generateForRouteMock } = vi.hoisted(
  () => ({
    launchMock: vi.fn(),
    getChangedFilesMock: vi.fn(),
    createPlannerMock: vi.fn(),
    generateForRouteMock: vi.fn(),
  }),
);

vi.mock('playwright', () => ({ chromium: { launch: launchMock } }));

vi.mock('../src/diff.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/diff.js')>();
  return { ...original, getChangedFiles: getChangedFilesMock };
});

vi.mock('../src/llm/brain.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/llm/brain.js')>();
  return { ...original, createPlanner: createPlannerMock };
});

vi.mock('../src/planner.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/planner.js')>();
  return { ...original, generateForRoute: generateForRouteMock };
});

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from '../src/commands/run.js';
import { planCommand } from '../src/commands/plan.js';
import { PlannerError } from '../src/planner.js';

const CART_TEST = `summary: Cart discount
priority: P0
tags: [cart]
routes: ["/cart"]
steps:
  - apply a discount
`;

const DRAFT = {
  summary: 'Applying a discount updates the cart total',
  steps: ['open the cart', 'apply the discount', 'check the total drops'],
  priority: 'P0' as const,
  tags: ['cart'],
};

let dir: string;
let logs: string[];
let errors: string[];

const out = (): string => logs.join('\n');
const errOut = (): string => errors.join('\n');

/** Minimal browser double: one context, one page, both closable. */
function fakeBrowser(): { close: () => Promise<void> } {
  const page = { setDefaultTimeout: () => {} };
  const context = { newPage: async () => page, close: async () => {} };
  return {
    newContext: async () => context,
    close: async () => {},
  } as unknown as { close: () => Promise<void> };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-plan-'));
  logs = [];
  errors = [];
  launchMock.mockReset();
  getChangedFilesMock.mockReset();
  createPlannerMock.mockReset();
  generateForRouteMock.mockReset();

  launchMock.mockResolvedValue(fakeBrowser());
  // Preflight probes the provider and base_url with plain `fetch`; stubbed so
  // these tests never depend on real network or a running app (spec preflight).
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
  createPlannerMock.mockReturnValue({ planTest: vi.fn() });
  generateForRouteMock.mockImplementation(async (_page: unknown, options: { route: string }) => ({
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

async function writeProject(
  tests: Record<string, string> = {},
  extraConfig = '',
): Promise<void> {
  const config = [
    'base_url: http://localhost:4173',
    'llm:',
    '  provider: anthropic',
    '  api_key_env: BLASTPROOF_TEST_KEY',
    'routes:',
    '  "src/cart/**": ["/cart"]',
    '  "src/settings/**": ["/settings"]',
    extraConfig,
    '',
  ].join('\n');
  await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
  await writeFile(path.join(dir, '.blastproof', 'config.yaml'), config);
  for (const [name, content] of Object.entries(tests)) {
    await writeFile(path.join(dir, '.blastproof', 'tests', name), content);
  }
}

const testsDir = (): string => path.join(dir, '.blastproof', 'tests');

describe('planCommand route selection', () => {
  it('generates only for affected routes no test covers', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts', 'src/settings/flags.ts']);

    const code = await planCommand({ cwd: dir });

    expect(code).toBe(EXIT_OK);
    expect(generateForRouteMock).toHaveBeenCalledTimes(1);
    expect(generateForRouteMock.mock.calls[0]?.[1]).toMatchObject({
      route: '/settings',
      changedFiles: ['src/settings/flags.ts'],
    });
    expect(out()).toContain('Already covered (skipped)');
    expect(out()).toContain('/cart');
  });

  it('supplies the configured browser.max_snapshot_lines to generateForRoute (browser-patience task 3.2)', async () => {
    await writeProject(
      { 'cart.yaml': CART_TEST },
      ['browser:', '  max_snapshot_lines: 400'].join('\n'),
    );
    getChangedFilesMock.mockResolvedValue(['src/settings/flags.ts']);

    const code = await planCommand({ cwd: dir });

    expect(code).toBe(EXIT_OK);
    expect(generateForRouteMock).toHaveBeenCalledTimes(1);
    expect(generateForRouteMock.mock.calls[0]?.[1]).toMatchObject({
      maxSnapshotLines: 400,
    });
  });

  it('exits 0 without browser or LLM when everything is covered', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts']);

    const code = await planCommand({ cwd: dir });

    expect(code).toBe(EXIT_OK);
    expect(launchMock).not.toHaveBeenCalled();
    expect(generateForRouteMock).not.toHaveBeenCalled();
    expect(out()).toContain('Nothing to generate');
  });

  it('bypasses the diff entirely with --route', async () => {
    await writeProject();

    const code = await planCommand({ cwd: dir, routes: ['/login', '/cart'] });

    expect(code).toBe(EXIT_OK);
    expect(getChangedFilesMock).not.toHaveBeenCalled();
    expect(generateForRouteMock).toHaveBeenCalledTimes(2);
    expect(generateForRouteMock.mock.calls.map((call) => call[1].route)).toEqual([
      '/login',
      '/cart',
    ]);
  });

  it('passes the --base ref through to the diff', async () => {
    await writeProject();
    getChangedFilesMock.mockResolvedValue([]);

    await planCommand({ cwd: dir, base: 'develop' });

    expect(getChangedFilesMock).toHaveBeenCalledWith('develop', dir);
  });

  it('exits 2 with the DiffError message before any browser launch', async () => {
    await writeProject();
    getChangedFilesMock.mockRejectedValue(
      new DiffError("Cannot compute diff: base ref 'nope' does not exist in this repository."),
    );

    const code = await planCommand({ cwd: dir, base: 'nope' });

    expect(code).toBe(EXIT_USAGE);
    expect(errOut()).toContain("base ref 'nope' does not exist");
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('exits 2 when the API key is missing, before launching a browser', async () => {
    delete process.env.BLASTPROOF_TEST_KEY;
    await writeProject();

    const code = await planCommand({ cwd: dir, routes: ['/cart'] });

    expect(code).toBe(EXIT_USAGE);
    expect(errOut()).toContain('BLASTPROOF_TEST_KEY');
    expect(launchMock).not.toHaveBeenCalled();
  });
});

describe('planCommand --dry-run (spec cli-plan-command)', () => {
  it('reports the affected-but-uncovered routes without a browser or the LLM, and exits 0', async () => {
    delete process.env.BLASTPROOF_TEST_KEY;
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts', 'src/settings/flags.ts']);

    const code = await planCommand({ cwd: dir, dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(launchMock).not.toHaveBeenCalled();
    expect(generateForRouteMock).not.toHaveBeenCalled();
    expect(out()).toContain('Dry run: 1 route(s) would generate a draft for');
    expect(out()).toContain('/settings');
    expect(out()).toContain('no browser launched, no LLM calls made');
  });

  it('says so and exits 0 when every affected route is already covered', async () => {
    delete process.env.BLASTPROOF_TEST_KEY;
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts']);

    const code = await planCommand({ cwd: dir, dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(launchMock).not.toHaveBeenCalled();
    expect(out()).toContain('Nothing to generate: no affected route is missing coverage.');
  });

  it('succeeds with no provider key configured', async () => {
    delete process.env.BLASTPROOF_TEST_KEY;
    await writeProject();

    const code = await planCommand({ cwd: dir, routes: ['/cart'], dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(errOut()).toBe('');
  });
});

describe('planCommand preview vs write', () => {
  it('previews to stdout without touching disk', async () => {
    await writeProject();

    const code = await planCommand({ cwd: dir, routes: ['/cart'] });

    expect(code).toBe(EXIT_OK);
    expect(await readdir(testsDir())).toEqual([]);
    expect(out()).toContain('summary: Applying a discount updates the cart total');
    expect(out()).toContain('Preview only: no files written');
  });

  it('--write persists drafts and reports their paths', async () => {
    await writeProject();

    const code = await planCommand({ cwd: dir, routes: ['/cart', '/settings'], write: true });

    expect(code).toBe(EXIT_OK);
    expect((await readdir(testsDir())).sort()).toEqual(['cart.yaml', 'settings.yaml']);
    const written = await readFile(path.join(testsDir(), 'cart.yaml'), 'utf8');
    expect(written).toContain('# route: /cart');
    expect(written).toContain('routes:');
    expect(out()).toContain(path.join('.blastproof', 'tests', 'cart.yaml'));
  });

  it('--write reports a collision as a failure and exits 1', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    // /cart is covered by cart.yaml, so ask for it explicitly to reach the write step.
    const code = await planCommand({ cwd: dir, routes: ['/cart'], write: true });

    expect(code).toBe(EXIT_FAILED);
    expect(out()).toContain('Refusing to overwrite');
    await expect(readFile(path.join(testsDir(), 'cart.yaml'), 'utf8')).resolves.toContain(
      'apply a discount',
    );
  });
});

describe('planCommand budget (spec run-budget: test planning counts against the budget)', () => {
  it('wires the resolved budget (flag > config) into createPlanner', async () => {
    await writeProject();

    const code = await planCommand({ cwd: dir, routes: ['/cart'], maxLlmCalls: 1 });

    expect(code).toBe(EXIT_OK);
    expect(createPlannerMock).toHaveBeenCalled();
    const budget = createPlannerMock.mock.calls.at(-1)?.[2];
    expect(budget).toBeDefined();
    budget.check(); // 0 calls recorded yet: must not throw
    budget.record(undefined);
    expect(() => budget.check()).toThrow(/model call budget exhausted/);
  });

  it('stops generating once the budget is exhausted, without misreporting it as a route failure', async () => {
    await writeProject();
    generateForRouteMock.mockImplementation(async (_page: unknown, options: { route: string }) => {
      if (options.route === '/cart') throw new BudgetExhaustedError('calls', 1, 1);
      return { ...DRAFT, routes: [options.route] };
    });

    const code = await planCommand({ cwd: dir, routes: ['/cart', '/settings'] });

    expect(code).toBe(EXIT_FAILED);
    // /settings was never attempted: the run stopped at /cart, it did not fail it.
    expect(generateForRouteMock).toHaveBeenCalledTimes(1);
    expect(out()).toContain('Stopped:');
    expect(out()).toContain('model call budget exhausted');
    expect(out()).not.toContain('Failed:');
    expect(out()).toContain('Not attempted (run out of budget):');
    expect(out()).toContain('/settings');
  });
});

describe('planCommand failure isolation', () => {
  it('keeps generating after a route fails and exits 1', async () => {
    await writeProject();
    generateForRouteMock.mockImplementation(async (_page: unknown, options: { route: string }) => {
      if (options.route === '/settings') throw new PlannerError('Cannot load /settings: timeout');
      return { ...DRAFT, routes: [options.route] };
    });

    const code = await planCommand({ cwd: dir, routes: ['/settings', '/cart'], write: true });

    expect(code).toBe(EXIT_FAILED);
    expect(await readdir(testsDir())).toEqual(['cart.yaml']);
    expect(out()).toContain('Failed:');
    expect(out()).toContain('/settings: Cannot load /settings: timeout');
    expect(out()).toContain('Generated: /cart');
  });
});

describe('planCommand preflight (spec preflight)', () => {
  it('reports the browser and the app being down together, in one run, and exits 2', async () => {
    await writeProject();
    launchMock.mockRejectedValue(new Error("Executable doesn't exist at /nope/chrome"));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === 'http://localhost:4173') return Promise.reject(new Error('ECONNREFUSED'));
        return Promise.resolve({});
      }),
    );

    const code = await planCommand({ cwd: dir, routes: ['/cart'] });

    expect(code).toBe(EXIT_USAGE);
    expect(errOut()).toMatch(/not installed/i);
    expect(errOut()).toMatch(/localhost:4173.*not responding|not responding.*localhost:4173/is);
    expect(errOut()).toContain('2 unmet prerequisite(s)');
    expect(generateForRouteMock).not.toHaveBeenCalled();
  });

  it('prints nothing extra when every prerequisite is met', async () => {
    await writeProject();

    const code = await planCommand({ cwd: dir, routes: ['/cart'] });

    expect(code).toBe(EXIT_OK);
    expect(errOut()).toBe('');
  });
});
