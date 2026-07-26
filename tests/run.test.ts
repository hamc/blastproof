import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiffError } from '../src/diff.js';

const { launchMock, getChangedFilesMock } = vi.hoisted(() => ({
  launchMock: vi.fn(),
  getChangedFilesMock: vi.fn(),
}));

vi.mock('playwright', () => ({ chromium: { launch: launchMock } }));

vi.mock('../src/diff.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/diff.js')>();
  return { ...original, getChangedFiles: getChangedFilesMock };
});

import { EXIT_OK, EXIT_USAGE, runCommand } from '../src/commands/run.js';

const CART_TEST = `summary: Cart discount
priority: P0
tags: [cart]
routes: ["/cart"]
steps:
  - apply a discount
`;

const LOGIN_TEST = `summary: Login succeeds
routes: ["/login"]
steps:
  - log in
`;

const UNROUTED_TEST = `summary: Legacy test
steps:
  - do a thing
`;

let dir: string;
let logs: string[];
let errors: string[];

const out = (): string => logs.join('\n');
const errOut = (): string => errors.join('\n');

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-run-'));
  logs = [];
  errors = [];
  launchMock.mockReset();
  getChangedFilesMock.mockReset();
  // The fixture config points at this never-set variable: reaching the LLM
  // phase would fail with a missing-key usage error, proving short-circuits.
  delete process.env.BLASTPROOF_TEST_MISSING_KEY;
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

async function writeProject(tests: Record<string, string>): Promise<void> {
  const config = [
    'base_url: http://localhost:4173',
    'llm:',
    '  provider: anthropic',
    '  api_key_env: BLASTPROOF_TEST_MISSING_KEY',
    'routes:',
    '  "src/cart/**": ["/cart"]',
    '  "src/auth/**": ["/login"]',
    '',
  ].join('\n');
  await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
  await writeFile(path.join(dir, '.blastproof', 'config.yaml'), config);
  for (const [name, content] of Object.entries(tests)) {
    await writeFile(path.join(dir, '.blastproof', 'tests', name), content);
  }
}

describe('runCommand --impacted', () => {
  it('exits 0 without browser or LLM key when the diff maps to no covered routes', async () => {
    await writeProject({ 'cart.yaml': CART_TEST, 'legacy.yaml': UNROUTED_TEST });
    getChangedFilesMock.mockResolvedValue(['docs/guide.md']);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true });

    expect(code).toBe(EXIT_OK);
    expect(launchMock).not.toHaveBeenCalled();
    expect(getChangedFilesMock).toHaveBeenCalledWith('main', dir);
    expect(out()).toContain('Affected routes: none');
    expect(out()).toContain('Unmapped files');
    expect(out()).toContain('docs/guide.md');
    expect(out()).toContain('Unrouted tests (skipped)');
    expect(out()).toContain('Legacy test');
    expect(out()).toContain('No impacted tests to run.');
  });

  it('reports affected-but-uncovered routes and exits 0', async () => {
    await writeProject({ 'login.yaml': LOGIN_TEST });
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts']);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true });

    expect(code).toBe(EXIT_OK);
    expect(launchMock).not.toHaveBeenCalled();
    expect(out()).toContain('Affected but uncovered routes');
    expect(out()).toContain('/cart');
  });

  it('passes the --base ref through to the diff', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockResolvedValue([]);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true, base: 'develop' });

    expect(code).toBe(EXIT_OK);
    expect(getChangedFilesMock).toHaveBeenCalledWith('develop', dir);
  });

  it('exits 2 with the DiffError message before any browser launch', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockRejectedValue(
      new DiffError("Cannot compute diff: base ref 'main' does not exist in this repository."),
    );

    const code = await runCommand({ cwd: dir, tags: [], impacted: true });

    expect(code).toBe(EXIT_USAGE);
    expect(errOut()).toContain("base ref 'main' does not exist");
    expect(launchMock).not.toHaveBeenCalled();
  });
});

describe('runCommand --dry-run', () => {
  it('prints the impacted selection plan and exits 0 without browser/LLM', async () => {
    await writeProject({
      'cart.yaml': CART_TEST,
      'login.yaml': LOGIN_TEST,
      'legacy.yaml': UNROUTED_TEST,
    });
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts', 'docs/guide.md']);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true, dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(launchMock).not.toHaveBeenCalled();
    expect(out()).toContain('Affected routes:');
    expect(out()).toContain('/cart');
    expect(out()).toContain('Unmapped files');
    expect(out()).toContain('docs/guide.md');
    expect(out()).toContain('Unrouted tests (skipped)');
    expect(out()).toContain('Legacy test');
    expect(out()).toContain('Dry run: 1 test(s) selected');
    expect(out()).toContain('Cart discount');
    // The routed-but-not-impacted login test is neither selected nor reported.
    expect(out()).not.toContain('Login succeeds');
    expect(out()).toContain('no browser launched, no LLM calls made');
  });

  it('without --impacted, prints the tests that would run after filters', async () => {
    await writeProject({
      'smoke.yaml': 'summary: Smoke test\ntags: [smoke]\nsteps:\n  - check it\n',
      'other.yaml': 'summary: Other test\nsteps:\n  - check that\n',
    });

    const code = await runCommand({ cwd: dir, tags: ['smoke'], dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(launchMock).not.toHaveBeenCalled();
    expect(getChangedFilesMock).not.toHaveBeenCalled();
    expect(out()).toContain('Smoke test');
    expect(out()).not.toContain('Other test');
  });
});

describe('runCommand --url', () => {
  it('overrides config base_url for the run without touching the config file', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts']);

    const code = await runCommand({
      cwd: dir,
      tags: [],
      impacted: true,
      dryRun: true,
      url: 'https://preview-pr-42.example.com',
    });

    expect(code).toBe(EXIT_OK);
    expect(out()).toContain('base_url=https://preview-pr-42.example.com');
    expect(out()).not.toContain('base_url=http://localhost:4173');
    const raw = await readFile(path.join(dir, '.blastproof', 'config.yaml'), 'utf8');
    expect(raw).toContain('base_url: http://localhost:4173');
  });

  it('exits 2 with an actionable message on an invalid URL', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });

    const code = await runCommand({ cwd: dir, tags: [], url: 'not-a-url' });

    expect(code).toBe(EXIT_USAGE);
    expect(errOut()).toContain("Invalid --url 'not-a-url'");
    expect(launchMock).not.toHaveBeenCalled();
    expect(getChangedFilesMock).not.toHaveBeenCalled();
  });
});
