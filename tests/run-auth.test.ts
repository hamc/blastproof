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

// The login journey and the tests both go through the executor; stubbing it keeps
// these tests about wiring — who authenticates, and which context each test gets.
vi.mock('../src/runner/executor.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/runner/executor.js')>();
  return { ...original, executeTest: executeTestMock };
});

vi.mock('../src/llm/brain.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/llm/brain.js')>();
  return { ...original, createBrain: createBrainMock };
});

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, runCommand } from '../src/commands/run.js';
import { BudgetExhaustedError } from '../src/runner/budget.js';

const AUTH_CONFIG = [
  'base_url: http://localhost:4173',
  'llm:',
  '  provider: anthropic',
  '  api_key_env: BLASTPROOF_AUTH_TEST_KEY',
  'auth:',
  '  steps:',
  '    - sign in',
  '',
].join('\n');

const AUTHED = 'summary: Account page works\nsteps:\n  - open the account page\n';
const PUBLIC = 'summary: Login page works\nauth: false\nsteps:\n  - open the login page\n';

const CAPTURED = { cookies: [{ name: 'session', value: 'abc' }], origins: [] };

let dir: string;
let logs: string[];
let errors: string[];
let contextOptionsSeen: Record<string, unknown>[];

const out = (): string => logs.join('\n');
const errOut = (): string => errors.join('\n');

/** Records the options every context is created with, so seeding is observable. */
function browserDouble(): unknown {
  return {
    newContext: async (options: Record<string, unknown> = {}) => {
      contextOptionsSeen.push(options);
      return {
        newPage: async () => ({ setDefaultTimeout: () => {} }),
        storageState: async () => CAPTURED,
        close: async () => {},
      };
    },
    close: async () => {},
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-runauth-'));
  logs = [];
  errors = [];
  contextOptionsSeen = [];
  launchMock.mockReset();
  createBrainMock.mockReset();
  executeTestMock.mockReset();

  launchMock.mockResolvedValue(browserDouble());
  // Preflight probes the provider and base_url with plain `fetch`; stubbed so
  // these tests never depend on real network or a running app (spec preflight).
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
  createBrainMock.mockReturnValue({ nextAction: vi.fn(), judge: vi.fn() });
  executeTestMock.mockImplementation(async (_page: unknown, test: { path: string; summary: string }) => ({
    file: test.path,
    summary: test.summary,
    priority: 'P0',
    tags: [],
    status: 'passed' as const,
    steps: [],
    durationMs: 10,
  }));
  process.env.BLASTPROOF_AUTH_TEST_KEY = 'key';

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
  delete process.env.BLASTPROOF_AUTH_TEST_KEY;
  await rm(dir, { recursive: true, force: true });
});

async function writeProject(tests: Record<string, string>): Promise<void> {
  await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
  await writeFile(path.join(dir, '.blastproof', 'config.yaml'), AUTH_CONFIG);
  for (const [name, content] of Object.entries(tests)) {
    await writeFile(path.join(dir, '.blastproof', 'tests', name), content);
  }
}

describe('runCommand authentication', () => {
  it('authenticates once and seeds every authenticated test context', async () => {
    await writeProject({ 'a.yaml': AUTHED, 'b.yaml': AUTHED });

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    // One context for the login journey, then one per test — the login ran once.
    expect(contextOptionsSeen).toHaveLength(3);
    expect(contextOptionsSeen[0]).toEqual({});
    expect(contextOptionsSeen[1]).toMatchObject({ storageState: CAPTURED });
    expect(contextOptionsSeen[2]).toMatchObject({ storageState: CAPTURED });
    expect(out()).toContain('Authenticating...');
  });

  it('gives an auth: false test an empty context', async () => {
    // Alongside an authenticated test, so the login still happens and the subject
    // of this test stays the context rather than the predicate (#102).
    await writeProject({ 'a.yaml': AUTHED, 'public.yaml': PUBLIC });

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    expect(contextOptionsSeen).toHaveLength(3);
    expect(contextOptionsSeen[0]).toEqual({}); // the login journey
    expect(contextOptionsSeen[1]).toMatchObject({ storageState: CAPTURED });
    expect(contextOptionsSeen[2]).toEqual({}); // public.yaml opted out
  });

  it('performs no login when every selected test declares auth: false (#102)', async () => {
    await writeProject({ 'public.yaml': PUBLIC, 'public2.yaml': PUBLIC });

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    // Two test contexts and no third: `authenticate` never created its own.
    expect(contextOptionsSeen).toHaveLength(2);
    expect(contextOptionsSeen.every((options) => Object.keys(options).length === 0)).toBe(true);
    // Nothing is printed about the login that did not happen (design D5).
    expect(out()).not.toContain('Authenticating');
    expect(out()).not.toContain('skipped');
  });

  it('logs in when a single selected test wants the session (#102)', async () => {
    // `some`, not `every` — one authenticated test among many that opted out is
    // enough, and the login runs exactly as it would for a fully authed selection.
    await writeProject({ 'public.yaml': PUBLIC, 'public2.yaml': PUBLIC, 'z-authed.yaml': AUTHED });

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    expect(out()).toContain('Authenticating...');
    expect(contextOptionsSeen).toHaveLength(4);
    expect(contextOptionsSeen.filter((options) => 'storageState' in options)).toHaveLength(1);
  });

  it('is unaffected when the suite never declares auth: at all (#102)', async () => {
    // `auth` defaults to true (src/runner/testfile.ts), so a suite that does not
    // mention the field behaves exactly as it did before the predicate existed.
    expect(AUTHED).not.toContain('auth:');
    await writeProject({ 'a.yaml': AUTHED, 'b.yaml': AUTHED });

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    expect(out()).toContain('Authenticating...');
    expect(contextOptionsSeen).toHaveLength(3);
  });

  it('does not run auth.verify when no login was performed (#102)', async () => {
    // `verify` judges the page the login produced; with no login there is nothing
    // to verify, and `brain.judge` is how it would have been observed.
    const judge = vi.fn();
    createBrainMock.mockReturnValue({ nextAction: vi.fn(), judge });
    await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
    await writeFile(
      path.join(dir, '.blastproof', 'config.yaml'),
      `${AUTH_CONFIG.trimEnd()}\n  verify: the page shows a welcome heading\n`,
    );
    await writeFile(path.join(dir, '.blastproof', 'tests', 'public.yaml'), PUBLIC);

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    expect(judge).not.toHaveBeenCalled();
  });

  it('aborts with exit 2 before any test when authentication fails', async () => {
    await writeProject({ 'a.yaml': AUTHED });
    executeTestMock.mockImplementation(async (_page: unknown, test: { path: string; summary: string }) => ({
      file: test.path,
      summary: test.summary,
      priority: 'P0',
      tags: [],
      status: 'failed' as const,
      steps: [],
      failedStep: 'sign in',
      reason: 'credentials rejected',
      durationMs: 10,
    }));

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_USAGE);
    expect(errOut()).toContain('Authentication failed');
    // Only the login context was created: no test ran.
    expect(contextOptionsSeen).toHaveLength(1);
    // A failed login is a config problem, not a product defect: no misleading score.
    expect(out()).not.toContain('Score:');
  });

  it('threads the configured browser.timeout_ms into the login journey too, not only the tests that follow (browser-patience)', async () => {
    // The defect: `runJourney`'s call in auth.ts passed everything but `timeoutMs`
    // (and `maxSnapshotLines`), so a slow login element was bound by a fixed 2s
    // regardless of config — the worst place for this gap, since a failed login
    // aborts the whole run, not one test.
    const config = [
      'base_url: http://localhost:4173',
      'llm:',
      '  provider: anthropic',
      '  api_key_env: BLASTPROOF_AUTH_TEST_KEY',
      'browser:',
      '  timeout_ms: 45000',
      'auth:',
      '  steps:',
      '    - sign in',
      '',
    ].join('\n');
    await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
    await writeFile(path.join(dir, '.blastproof', 'config.yaml'), config);
    await writeFile(path.join(dir, '.blastproof', 'tests', 'a.yaml'), AUTHED);

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    const loginCall = executeTestMock.mock.calls.find(
      (call) => (call[1] as { path?: string }).path === '<auth>',
    );
    expect(loginCall).toBeDefined();
    expect((loginCall?.[2] as { timeoutMs?: number }).timeoutMs).toBe(45_000);
  });

  it('does nothing extra when no recipe is configured', async () => {
    await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
    await writeFile(
      path.join(dir, '.blastproof', 'config.yaml'),
      'base_url: http://localhost:4173\nllm:\n  api_key_env: BLASTPROOF_AUTH_TEST_KEY\n',
    );
    await writeFile(path.join(dir, '.blastproof', 'tests', 'a.yaml'), AUTHED);

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    expect(contextOptionsSeen).toHaveLength(1); // just the test
    expect(contextOptionsSeen[0]).toEqual({});
    expect(out()).not.toContain('Authenticating');
  });
});

// The two consequences that make #102 a defect rather than waste: a session file
// nothing would have read aborting the run, and a budget spent on a login nothing
// selected needed turning into a verdict.
describe('runCommand authentication is not incurred by a selection that opted out (#102)', () => {
  const STORAGE_CONFIG = [
    'base_url: http://localhost:4173',
    'llm:',
    '  provider: anthropic',
    '  api_key_env: BLASTPROOF_AUTH_TEST_KEY',
    'auth:',
    '  storage_state: .blastproof/never-captured.json',
    '',
  ].join('\n');

  async function writeStorageProject(tests: Record<string, string>): Promise<void> {
    await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
    await writeFile(path.join(dir, '.blastproof', 'config.yaml'), STORAGE_CONFIG);
    for (const [name, content] of Object.entries(tests)) {
      await writeFile(path.join(dir, '.blastproof', 'tests', name), content);
    }
  }

  it('an unreadable storage_state does not fail a run in which nothing would read it', async () => {
    // The strongest of the three defects, and why the predicate covers every
    // strategy rather than only `steps` (design D2): `resolveSession` throws
    // `AuthError` on a missing file, which run turns into exit 2 before any test.
    await writeStorageProject({ 'public.yaml': PUBLIC });

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    expect(errOut()).not.toContain('auth.storage_state');
  });

  it('an unreadable storage_state still fails a run whose selection wants the session', async () => {
    await writeStorageProject({ 'a.yaml': AUTHED });

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_USAGE);
    expect(errOut()).toContain('Cannot read auth.storage_state');
  });

  it('a budget that would have been exhausted by the login no longer reports incomplete', async () => {
    // Only the login journey exhausts the budget here; the selected test itself
    // runs fine. Before the predicate, the run was marked incomplete and exited 1
    // regardless of --min-score — a wrong verdict produced by unnecessary work.
    await writeProject({ 'public.yaml': PUBLIC });
    executeTestMock.mockImplementation(async (_page: unknown, test: { path: string; summary: string }) => {
      if (test.path === '<auth>') throw new BudgetExhaustedError('calls', 5, 5);
      return {
        file: test.path,
        summary: test.summary,
        priority: 'P0',
        tags: [],
        status: 'passed' as const,
        steps: [],
        durationMs: 10,
      };
    });

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_OK);
    expect(code).not.toBe(EXIT_FAILED);
    expect(out()).not.toContain('Run incomplete');
    expect(out()).not.toContain('NOT RUN');
  });
});
