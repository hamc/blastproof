import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiffError } from '../src/diff.js';

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
