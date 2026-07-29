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

vi.mock('../src/runner/executor.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/runner/executor.js')>();
  return { ...original, executeTest: executeTestMock };
});

vi.mock('../src/llm/brain.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/llm/brain.js')>();
  return { ...original, createBrain: createBrainMock };
});

import { EXIT_OK, EXIT_USAGE, runCommand } from '../src/commands/run.js';

const CONFIG = [
  'base_url: http://localhost:4173',
  'llm:',
  '  provider: anthropic',
  '  api_key_env: BLASTPROOF_PREFLIGHT_TEST_KEY',
  '',
].join('\n');

const TEST_A = 'summary: Test A\npriority: P0\nsteps:\n  - do a\n';

let dir: string;
let logs: string[];
let errors: string[];

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
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-run-preflight-'));
  logs = [];
  errors = [];
  launchMock.mockReset();
  createBrainMock.mockReset();
  executeTestMock.mockReset();

  createBrainMock.mockReturnValue({ nextAction: vi.fn(), judge: vi.fn() });
  executeTestMock.mockImplementation(
    async (_page: unknown, test: { path: string; summary: string; priority: string; tags: string[] }) => ({
      file: test.path,
      summary: test.summary,
      priority: test.priority,
      tags: test.tags,
      status: 'passed' as const,
      steps: [],
      durationMs: 5,
    }),
  );
  process.env.BLASTPROOF_PREFLIGHT_TEST_KEY = 'key';

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
  delete process.env.BLASTPROOF_PREFLIGHT_TEST_KEY;
  await rm(dir, { recursive: true, force: true });
});

async function writeProject(): Promise<void> {
  await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
  await writeFile(path.join(dir, '.blastproof', 'config.yaml'), CONFIG);
  await writeFile(path.join(dir, '.blastproof', 'tests', 'a.yaml'), TEST_A);
}

describe('runCommand preflight (spec preflight)', () => {
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

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_USAGE);
    // Both prerequisites named together — not one crash per run (design D2).
    expect(errOut()).toMatch(/not installed/i);
    expect(errOut()).toMatch(/localhost:4173.*not responding|not responding.*localhost:4173/is);
    expect(errOut()).toContain('2 unmet prerequisite(s)');
    // Neither test ever ran.
    expect(executeTestMock).not.toHaveBeenCalled();
  });

  it('prints nothing extra when every prerequisite is met', async () => {
    await writeProject();
    launchMock.mockResolvedValue(browserDouble());
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    expect(errOut()).toBe('');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('performs neither the browser nor the model check on a dry run', async () => {
    await writeProject();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const code = await runCommand({ cwd: dir, tags: [], dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(launchMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
