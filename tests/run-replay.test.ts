import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetExhaustedError } from '../src/runner/budget.js';
import { replayDir, replayFile, saveReplay, type ReplayOutcome, type SavedStep } from '../src/runner/replay.js';

const { launchMock, createBrainMock, executeTestMock } = vi.hoisted(() => ({
  launchMock: vi.fn(),
  createBrainMock: vi.fn(),
  executeTestMock: vi.fn(),
}));

vi.mock('playwright', async (importOriginal) => {
  const original = await importOriginal<typeof import('playwright')>();
  return { ...original, chromium: { launch: launchMock } };
});
vi.mock('../src/runner/executor.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/runner/executor.js')>();
  return { ...original, executeTest: executeTestMock };
});
vi.mock('../src/llm/brain.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/llm/brain.js')>();
  return { ...original, createBrain: createBrainMock };
});

import { runCommand } from '../src/commands/run.js';

const config = (extra = ''): string =>
  ['base_url: http://localhost:4173', 'llm:', '  provider: anthropic', '  api_key_env: BLASTPROOF_REPLAY_TEST_KEY', extra, ''].join('\n');

let dir: string;
let logs: string[];
let testPath: string;

const step = (key: string): SavedStep => ({
  key,
  actions: [{ action: 'click', role: 'button', name: 'Add note', changed: true }],
  close: { by: 'done' },
});

/** What the mocked executor returns: a result of that status carrying that outcome. */
function executorReturns(status: 'passed' | 'failed', replay: ReplayOutcome | undefined, decidedBy?: 'replayed' | 'model' | 'healed'): void {
  executeTestMock.mockImplementation(async (_page: unknown, test: { path: string; summary: string; priority: string; tags: string[] }) => ({
    file: test.path,
    summary: test.summary,
    priority: test.priority,
    tags: test.tags,
    status,
    steps: [
      { step: 'do a', setup: false, status, iterations: 1, failedAttempts: 0, durationMs: 1, ...(decidedBy ? { decidedBy } : {}) },
    ],
    ...(status === 'failed' ? { failedStep: 'do a', reason: 'no' } : {}),
    durationMs: 1,
    ...(replay ? { replay } : {}),
  }));
}

const optionsGiven = (): { replay?: { saved: SavedStep[] } } => executeTestMock.mock.calls.at(-1)![2];
const fileOnDisk = async (): Promise<{ steps: SavedStep[] } | undefined> =>
  readFile(replayFile(dir, testPath), 'utf8').then(JSON.parse, () => undefined);

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-runreplay-'));
  testPath = path.join(dir, '.blastproof', 'tests', 'a.yaml');
  logs = [];
  launchMock.mockReset();
  createBrainMock.mockReset();
  executeTestMock.mockReset();
  launchMock.mockResolvedValue({
    newContext: async () => ({
      newPage: async () => ({ setDefaultTimeout: () => {} }),
      storageState: async () => ({ cookies: [], origins: [] }),
      close: async () => {},
    }),
    close: async () => {},
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
  createBrainMock.mockReturnValue({ nextAction: vi.fn(), judge: vi.fn() });
  process.env.BLASTPROOF_REPLAY_TEST_KEY = 'key';
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.BLASTPROOF_REPLAY_TEST_KEY;
  await rm(dir, { recursive: true, force: true });
});

async function writeProject(configText: string): Promise<void> {
  await mkdir(path.dirname(testPath), { recursive: true });
  await writeFile(path.join(dir, '.blastproof', 'config.yaml'), configText);
  await writeFile(testPath, 'summary: Test A\npriority: P0\nsteps:\n  - do a\n');
}

describe('run with replay (replay-the-actions-of-a-passing-step)', () => {
  it('is off by default: the executor is given no replay and nothing is written', async () => {
    await writeProject(config());
    executorReturns('passed', undefined);

    await runCommand({ cwd: dir, tags: [] });

    expect(optionsGiven().replay).toBeUndefined();
    await expect(readdir(replayDir(dir))).rejects.toThrow();
    expect(logs.join('\n')).not.toContain('Replay:');
  });

  it('saves a passing test, and gives the next run what it saved', async () => {
    await writeProject(config('replay: true'));
    executorReturns('passed', { steps: [step('k1')], ended: [] }, 'model');

    await runCommand({ cwd: dir, tags: [] });
    expect(optionsGiven().replay).toEqual({ saved: [] });
    expect((await fileOnDisk())!.steps).toEqual([step('k1')]);
    expect(logs.join('\n')).toContain('Replay: 0 steps replayed, 1 resolved by the model');

    executorReturns('passed', { steps: [step('k1')], ended: [] }, 'replayed');
    await runCommand({ cwd: dir, tags: [] });
    expect(optionsGiven().replay).toEqual({ saved: [step('k1')] });
    expect(logs.join('\n')).toContain('Replay: 1 step replayed, 0 resolved by the model');
  });

  it('is turned on by --replay and off by --no-replay, over the config', async () => {
    await writeProject(config());
    executorReturns('passed', { steps: [step('k1')], ended: [] });
    await runCommand({ cwd: dir, tags: [], replay: true });
    expect(optionsGiven().replay).toEqual({ saved: [] });
    expect(await fileOnDisk()).toBeDefined();

    await writeFile(path.join(dir, '.blastproof', 'config.yaml'), config('replay: true'));
    await rm(replayDir(dir), { recursive: true });
    executorReturns('passed', undefined);
    await runCommand({ cwd: dir, tags: [], replay: false });
    expect(optionsGiven().replay).toBeUndefined();
    expect(await fileOnDisk()).toBeUndefined();
  });

  it('starts from nothing when the directory was deleted', async () => {
    await writeProject(config('replay: true'));
    executorReturns('passed', { steps: [step('k1')], ended: [] });
    await runCommand({ cwd: dir, tags: [] });
    await rm(path.join(dir, '.blastproof', 'cache'), { recursive: true });

    await runCommand({ cwd: dir, tags: [] });

    expect(optionsGiven().replay).toEqual({ saved: [] });
    expect((await fileOnDisk())!.steps).toEqual([step('k1')]);
  });

  it('drops a step whose replay ended when the test failed, and saves nothing new', async () => {
    await writeProject(config('replay: true'));
    await saveReplay(replayFile(dir, testPath), undefined, [step('k1'), step('k2')]);
    executorReturns('failed', { steps: [step('new')], ended: ['k2'] });

    await runCommand({ cwd: dir, tags: [] });

    expect((await fileOnDisk())!.steps).toEqual([step('k1')]);
  });

  it('leaves the file as it is when a test failed and no replay ended', async () => {
    await writeProject(config('replay: true\nbrowser:\n  device: Pixel 7'));
    // Saved as the desktop: read as nothing by a run as a phone, and not emptied by it.
    await saveReplay(replayFile(dir, testPath), undefined, [step('k1')]);
    const before = await readFile(replayFile(dir, testPath), 'utf8');
    executorReturns('failed', { steps: [], ended: [] });

    await runCommand({ cwd: dir, tags: [] });

    expect(optionsGiven().replay).toEqual({ saved: [] });
    expect(await readFile(replayFile(dir, testPath), 'utf8')).toBe(before);
  });

  it('writes nothing for the test a stopped run was in', async () => {
    await writeProject(config('replay: true'));
    await saveReplay(replayFile(dir, testPath), undefined, [step('k1')]);
    const before = await readFile(replayFile(dir, testPath), 'utf8');
    executeTestMock.mockImplementation(async () => {
      throw new BudgetExhaustedError('calls', 1, 1);
    });

    await runCommand({ cwd: dir, tags: [] });

    expect(await readFile(replayFile(dir, testPath), 'utf8')).toBe(before);
  });
});
