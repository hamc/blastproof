import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { launchMock, createBrainMock, executeTestMock } = vi.hoisted(() => ({
  launchMock: vi.fn(),
  createBrainMock: vi.fn(),
  executeTestMock: vi.fn(),
}));

vi.mock('playwright', () => ({ chromium: { launch: launchMock } }));

// The executor is stubbed, but it is handed the run's mask exactly as the real
// one is — so calling `options.mask()` here stands in for a page that echoed the
// value, which is the whole subject of #109.
vi.mock('../src/runner/executor.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/runner/executor.js')>();
  return { ...original, executeTest: executeTestMock };
});

vi.mock('../src/llm/brain.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/llm/brain.js')>();
  return { ...original, createBrain: createBrainMock };
});

import { EXIT_OK, runCommand } from '../src/commands/run.js';

const CONFIG = [
  'base_url: http://localhost:4173',
  'llm:',
  '  provider: anthropic',
  '  api_key_env: BLASTPROOF_NEARMISS_KEY',
  '',
].join('\n');

const SECRET_TEST = 'summary: Promo code\nsteps:\n  - fill the promo code with {{env.PROBE_SECRET}}\n';
const OTHER_TEST = 'summary: Promo code again\nsteps:\n  - fill the promo code with {{env.PROBE_SECRET}}\n';

let dir: string;
let logs: string[];
let errors: string[];
/** What each stubbed test "saw" on the page, masked through the run's mask. */
let echoed: string;
let seen: string[];

const out = (): string => logs.join('\n');
const errOut = (): string => errors.join('\n');

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
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-nearmiss-'));
  logs = [];
  errors = [];
  seen = [];
  echoed = 'Unknown promo code "HUNTER2".';
  launchMock.mockReset();
  createBrainMock.mockReset();
  executeTestMock.mockReset();

  launchMock.mockResolvedValue(browserDouble());
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
  createBrainMock.mockReturnValue({ nextAction: vi.fn(), judge: vi.fn() });
  executeTestMock.mockImplementation(
    async (_page: unknown, test: { path: string; summary: string }, options: { mask: (t: string) => string }) => {
      seen.push(options.mask(echoed));
      return {
        file: test.path,
        summary: test.summary,
        priority: 'P0',
        tags: [],
        status: 'passed' as const,
        steps: [],
        durationMs: 10,
      };
    },
  );
  process.env.BLASTPROOF_NEARMISS_KEY = 'key';

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
  delete process.env.BLASTPROOF_NEARMISS_KEY;
  delete process.env.PROBE_SECRET;
  await rm(dir, { recursive: true, force: true });
});

async function writeProject(tests: Record<string, string>): Promise<void> {
  await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
  await writeFile(path.join(dir, '.blastproof', 'config.yaml'), CONFIG);
  for (const [name, content] of Object.entries(tests)) {
    await writeFile(path.join(dir, '.blastproof', 'tests', name), content);
  }
}

describe('runCommand: a secret the page reformatted (say-when-the-page-reformatted-a-secret)', () => {
  it('redacts it, names the variable once, and prints neither form of the value', async () => {
    process.env.PROBE_SECRET = 'hunter2';
    await writeProject({ 'a.yaml': SECRET_TEST, 'b.yaml': OTHER_TEST });

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    // Both tests saw the page; both were redacted.
    expect(seen).toEqual(['Unknown promo code "***".', 'Unknown promo code "***".']);
    // One line, though two tests near-missed the same variable.
    const lines = errors.filter((line) => line.includes('PROBE_SECRET'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('in a different form than the value supplied');
    const everything = `${out()}\n${errOut()}`;
    expect(everything).not.toContain('hunter2');
    expect(everything).not.toContain('HUNTER2');
  });

  it('says nothing when the page returned the value as supplied', async () => {
    process.env.PROBE_SECRET = 'HUNTER2';
    await writeProject({ 'a.yaml': SECRET_TEST });

    await runCommand({ cwd: dir, tags: [] });

    expect(seen).toEqual(['Unknown promo code "***".']);
    expect(errOut()).not.toContain('PROBE_SECRET');
    expect(errOut()).not.toContain('different form');
  });

  it('says nothing when no registered secret appeared on any page', async () => {
    process.env.PROBE_SECRET = 'hunter2';
    echoed = 'Your cart is empty.';
    await writeProject({ 'a.yaml': SECRET_TEST });

    await runCommand({ cwd: dir, tags: [] });

    expect(errOut()).not.toContain('different form');
  });

  it('changes no verdict: same score and exit code as a literal match', async () => {
    await writeProject({ 'a.yaml': SECRET_TEST });

    process.env.PROBE_SECRET = 'HUNTER2';
    const literalCode = await runCommand({ cwd: dir, tags: [] });
    const literalScore = out();

    logs = [];
    errors = [];
    process.env.PROBE_SECRET = 'hunter2';
    const nearMissCode = await runCommand({ cwd: dir, tags: [] });

    expect(nearMissCode).toBe(literalCode);
    expect(nearMissCode).toBe(EXIT_OK);
    expect(out().includes('Score: 100')).toBe(literalScore.includes('Score: 100'));
    expect(errOut()).toContain('PROBE_SECRET');
  });
});
