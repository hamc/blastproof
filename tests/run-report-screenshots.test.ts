import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { launchMock, createBrainMock, executeTestMock } = vi.hoisted(() => ({
  launchMock: vi.fn(),
  createBrainMock: vi.fn(),
  executeTestMock: vi.fn(),
}));

vi.mock('playwright', () => ({ chromium: { launch: launchMock } }));

// Stubbing the executor keeps these tests about one decision: what `run` tells
// the report to do with a screenshot the executor already captured.
vi.mock('../src/runner/executor.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/runner/executor.js')>();
  return { ...original, executeTest: executeTestMock };
});

vi.mock('../src/llm/brain.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/llm/brain.js')>();
  return { ...original, createBrain: createBrainMock };
});

import { EXIT_FAILED, runCommand } from '../src/commands/run.js';

const BASE_CONFIG = [
  'base_url: http://localhost:4173',
  'llm:',
  '  provider: anthropic',
  '  api_key_env: BLASTPROOF_SHOT_TEST_KEY',
  '',
];

const AUTH_BLOCK = ['auth:', '  steps:', '    - sign in with {{env.BLASTPROOF_SHOT_PASSWORD}}', ''];

const PLAIN = 'summary: Promo code\nsteps:\n  - apply promo code SAVE20\n';
const SECRET = 'summary: Promo code\nsteps:\n  - fill the promo code with {{env.BLASTPROOF_SHOT_SECRET}}\n';

// Distinctive, so "no byte of it reached the report" is a search, not a guess.
const BYTES = Buffer.from('pixels showing HUNTER2 in the promo field');

let dir: string;

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
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-runshot-'));
  launchMock.mockReset();
  createBrainMock.mockReset();
  executeTestMock.mockReset();

  launchMock.mockResolvedValue(browserDouble());
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
  createBrainMock.mockReturnValue({ nextAction: vi.fn(), judge: vi.fn() });
  // The login journey passes; every test fails with a screenshot written where
  // the real executor writes it, in the session directory it was handed.
  executeTestMock.mockImplementation(
    async (_page: unknown, test: { path: string; summary: string }, options: { sessionDir: string }) => {
      if (test.path === '<auth>') {
        return { file: test.path, summary: test.summary, priority: 'P0', tags: [], status: 'passed', steps: [], durationMs: 1 };
      }
      await mkdir(options.sessionDir, { recursive: true });
      const screenshot = path.join(options.sessionDir, 'promo-code.png');
      await writeFile(screenshot, BYTES);
      return {
        file: test.path,
        summary: test.summary,
        priority: 'P0',
        tags: [],
        status: 'failed' as const,
        steps: [],
        failedStep: test.summary,
        reason: 'Unknown promo code',
        screenshot,
        durationMs: 10,
      };
    },
  );
  process.env.BLASTPROOF_SHOT_TEST_KEY = 'key';
  process.env.BLASTPROOF_SHOT_SECRET = 'HUNTER2';
  process.env.BLASTPROOF_SHOT_PASSWORD = 'pw';

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.BLASTPROOF_SHOT_TEST_KEY;
  delete process.env.BLASTPROOF_SHOT_SECRET;
  delete process.env.BLASTPROOF_SHOT_PASSWORD;
  await rm(dir, { recursive: true, force: true });
});

async function writeProject(test: string, config: string[] = BASE_CONFIG): Promise<void> {
  await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
  await writeFile(path.join(dir, '.blastproof', 'config.yaml'), config.join('\n'));
  await writeFile(path.join(dir, '.blastproof', 'tests', 'promo.yaml'), test);
}

async function sessionName(): Promise<string> {
  const sessions = await readdir(path.join(dir, '.blastproof', 'reports'));
  return sessions[0]!;
}

async function defaultReport(): Promise<string> {
  return readFile(path.join(dir, '.blastproof', 'reports', await sessionName(), 'report.html'), 'utf8');
}

function expectWithheld(html: string): void {
  expect(html).not.toContain('data:');
  expect(html).not.toContain(BYTES.toString('base64'));
  expect(html).toContain('Screenshot withheld');
}

describe('runCommand --html: failure screenshots (withhold-a-screenshot-that-saw-a-secret)', () => {
  it('embeds the screenshot when nothing in the run referenced {{env.*}}', async () => {
    await writeProject(PLAIN);

    expect(await runCommand({ cwd: dir, tags: [], html: true })).toBe(EXIT_FAILED);

    const html = await defaultReport();
    expect(html).toContain(`src="data:image/png;base64,${BYTES.toString('base64')}"`);
    expect(html).not.toContain('Screenshot withheld');
  });

  it('withholds it, linking beside the report, when a test referenced {{env.*}}', async () => {
    await writeProject(SECRET);

    expect(await runCommand({ cwd: dir, tags: [], html: true })).toBe(EXIT_FAILED);

    const html = await defaultReport();
    expectWithheld(html);
    expect(html).toContain('<a href="promo-code.png">');
  });

  it('links relative to an explicit --html path outside the session directory', async () => {
    await writeProject(SECRET);

    await runCommand({ cwd: dir, tags: [], html: path.join('build', 'report.html') });

    const html = await readFile(path.join(dir, 'build', 'report.html'), 'utf8');
    expectWithheld(html);
    expect(html).toContain(`<a href="../.blastproof/reports/${await sessionName()}/promo-code.png">`);
  });

  it('withholds it when only the auth recipe referenced {{env.*}} (design D1)', async () => {
    // The failed test references nothing; the login credential is what the
    // authenticated page could be showing.
    await writeProject(PLAIN, [...BASE_CONFIG, ...AUTH_BLOCK]);

    expect(await runCommand({ cwd: dir, tags: [], html: true })).toBe(EXIT_FAILED);

    expectWithheld(await defaultReport());
  });
});
