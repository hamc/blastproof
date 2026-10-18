import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
import type { AgentBrain } from '../src/llm/brain.js';

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

describe('a run with a first judge reports and keeps its decisions (design a-decision-model-judges-first, D7)', () => {
  it('prints the summary line and writes first-judge.jsonl in the session directory', async () => {
    await writeProject('');
    process.env.BLASTPROOF_RUNTIMEOUT_JUDGE_KEY = 'sk-or';
    await writeFile(
      path.join(dir, '.blastproof', 'config.yaml'),
      [
        'base_url: http://localhost:4173',
        'llm:',
        '  provider: anthropic',
        '  api_key_env: BLASTPROOF_RUNTIMEOUT_TEST_KEY',
        'first_judge:',
        '  model: liquid/d1-ultra',
        '  api_key_env: BLASTPROOF_RUNTIMEOUT_JUDGE_KEY',
        '',
      ].join('\n'),
    );
    const decisions = vi.fn(async () =>
      new Response(JSON.stringify({ answers: { pass: { noul: 0.91 } }, usage: { input_tokens: 900, output_tokens: 0 } })),
    );
    vi.stubGlobal('fetch', decisions);
    // The real brain, as `runOne` built it, judging one step the way the executor does.
    executeTestMock.mockImplementation(
      async (
        _page: unknown,
        test: { path: string; summary: string; priority: string; tags: string[] },
        options: { brain: AgentBrain },
      ) => {
        const judgment = await options.brain.judge('verify the heading', 'the heading is shown', '- heading "Notes"');
        return {
          file: test.path,
          summary: test.summary,
          priority: test.priority,
          tags: test.tags,
          status: judgment.pass ? ('passed' as const) : ('failed' as const),
          steps: [],
          durationMs: 1,
        };
      },
    );

    try {
      const code = await runCommand({ cwd: dir, tags: [] });

      expect(code).toBe(EXIT_OK);
      expect(decisions).toHaveBeenCalledWith('https://openrouter.ai/api/alpha/decisions', expect.anything());
      expect(logs.join('\n')).toContain(
        'First judge (experimental, liquid/d1-ultra at 0.7): 1 passed, 0 to the LLM judge',
      );
      const [session] = await readdir(path.join(dir, '.blastproof', 'reports'));
      const lines = (await readFile(path.join(dir, '.blastproof', 'reports', session!, 'first-judge.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(lines).toEqual([
        expect.objectContaining({
          test: path.join('.blastproof', 'tests', 'a.yaml'),
          p: 0.91,
          outcome: 'passed',
          snapshot: '- heading "Notes"',
        }),
      ]);
    } finally {
      delete process.env.BLASTPROOF_RUNTIMEOUT_JUDGE_KEY;
    }
  });

  it('prints no first-judge line when none is configured', async () => {
    await writeProject('');
    await runCommand({ cwd: dir, tags: [] });
    expect(logs.join('\n')).not.toContain('First judge');
  });
});
