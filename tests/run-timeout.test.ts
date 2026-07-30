import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { launchMock, executeTestMock } = vi.hoisted(() => ({
  launchMock: vi.fn(),
  executeTestMock: vi.fn(),
}));

vi.mock('playwright', () => ({ chromium: { launch: launchMock } }));

// The defect (browser-patience): `browser.timeout_ms` never reached `executeTest`,
// so resolution and navigation always used a fixed default regardless of config.
// This mocks `executeTest` to inspect the options `runOne` actually builds, rather
// than only checking that `config.browser` parses a number (a test that would pass
// against the pre-fix code too).
vi.mock('../src/runner/executor.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/runner/executor.js')>();
  return { ...original, executeTest: executeTestMock };
});

import { EXIT_OK, runCommand } from '../src/commands/run.js';

const TEST_A = 'summary: Test A\npriority: P0\nsteps:\n  - do a\n';

let dir: string;
let logs: string[];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-runtimeout-'));
  logs = [];
  launchMock.mockReset();
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
  executeTestMock.mockImplementation(
    async (_page: unknown, test: { path: string; summary: string; priority: string; tags: string[] }) => ({
      file: test.path,
      summary: test.summary,
      priority: test.priority,
      tags: test.tags,
      status: 'passed' as const,
      steps: [],
      durationMs: 1,
    }),
  );
  process.env.BLASTPROOF_RUNTIMEOUT_TEST_KEY = 'key';

  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.BLASTPROOF_RUNTIMEOUT_TEST_KEY;
  await rm(dir, { recursive: true, force: true });
});

async function writeProject(browserSection: string): Promise<void> {
  const config = [
    'base_url: http://localhost:4173',
    'llm:',
    '  provider: anthropic',
    '  api_key_env: BLASTPROOF_RUNTIMEOUT_TEST_KEY',
    browserSection,
    '',
  ].join('\n');
  await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
  await writeFile(path.join(dir, '.blastproof', 'config.yaml'), config);
  await writeFile(path.join(dir, '.blastproof', 'tests', 'a.yaml'), TEST_A);
}

describe('runCommand threads the configured browser timeout and snapshot cap into executeTest (browser-patience task 1.1/3.2)', () => {
  it('supplies browser.timeout_ms as executeTest\'s timeoutMs, not left unset', async () => {
    await writeProject(['browser:', '  timeout_ms: 45000'].join('\n'));

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    expect(executeTestMock).toHaveBeenCalledTimes(1);
    const options = executeTestMock.mock.calls[0]?.[2];
    expect(options?.timeoutMs).toBe(45_000);
  });

  it('supplies browser.max_snapshot_lines as executeTest\'s maxSnapshotLines', async () => {
    await writeProject(['browser:', '  max_snapshot_lines: 350'].join('\n'));

    await runCommand({ cwd: dir, tags: [] });

    const options = executeTestMock.mock.calls[0]?.[2];
    expect(options?.maxSnapshotLines).toBe(350);
  });

  it('leaves maxSnapshotLines undefined when unset, unchanged from before this was configurable', async () => {
    await writeProject('');

    await runCommand({ cwd: dir, tags: [] });

    const options = executeTestMock.mock.calls[0]?.[2];
    expect(options?.maxSnapshotLines).toBeUndefined();
    // browser.timeout_ms always has a schema default (30s), same as before navigate
    // and the action itself were hardcoded/defaulted to it.
    expect(options?.timeoutMs).toBe(30_000);
  });
});
