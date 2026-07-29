import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, resolveBudgetOptions, runCommand } from '../src/commands/run.js';
import { loadConfig } from '../src/config.js';

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
  vi.unstubAllGlobals();
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
    expect(out()).toContain('Unclassified files');
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
    expect(out()).toContain('Unclassified files');
    expect(out()).toContain('docs/guide.md');
    expect(out()).toContain('Unrouted tests (skipped)');
    expect(out()).toContain('Legacy test');
    expect(out()).toContain('Dry run: 1 test(s) selected');
    expect(out()).toContain('Cart discount');
    // The routed-but-not-impacted login test is neither selected nor reported.
    expect(out()).not.toContain('Login succeeds');
    expect(out()).toContain('no browser launched, no LLM calls made');
    // Spec run-budget: the ceiling for the selection, labelled a maximum (design
    // D5) — CART_TEST has one step; default iteration cap 15 plus default retry
    // budget 3 (config `max_retries_per_step`, not assumed): 1 * (15 + 3) = 18.
    expect(out()).toContain('Worst case: up to 21 model call(s)');
    expect(out()).toContain('a maximum, not a prediction');
  });

  it('reports zero worst-case calls for an empty selection', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockResolvedValue(['docs/guide.md']);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true, dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(out()).toContain('Worst case: up to 0 model call(s)');
  });

  it('includes the login journey in the ceiling when auth.steps is configured (DEF-001 follow-up)', async () => {
    // `authenticate()` runs auth.steps through the same executeTest loop and
    // spends model calls (design D8) — a ceiling that omitted it would be
    // exceedable by the first real run of this same selection.
    const config = [
      'base_url: http://localhost:4173',
      'llm:',
      '  provider: anthropic',
      '  api_key_env: BLASTPROOF_TEST_MISSING_KEY',
      'routes:',
      '  "src/cart/**": ["/cart"]',
      'auth:',
      '  steps:',
      '    - go to the login page',
      '    - sign in with test credentials',
      '',
    ].join('\n');
    await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
    await writeFile(path.join(dir, '.blastproof', 'config.yaml'), config);
    await writeFile(path.join(dir, '.blastproof', 'tests', 'cart.yaml'), CART_TEST);
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts']);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true, dryRun: true });

    expect(code).toBe(EXIT_OK);
    // CART_TEST's 1 step plus auth's 2 steps = 3 * (15 + 3) = 54.
    expect(out()).toContain('Worst case: up to 63 model call(s)');
    expect(out()).toContain('including the login journey');
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

// A test file that cannot be parsed becomes a failed P1 result without any browser
// or LLM, which is the cheapest way to drive the score through runCommand.
const BROKEN_TEST = `summary: missing its steps
`;

describe('runCommand score and --min-score', () => {
  it('prints the score line on every run', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });

    const code = await runCommand({ cwd: dir, tags: [], query: 'nothing matches this' });

    expect(code).toBe(EXIT_OK);
    expect(out()).toContain('Score: 100 (no tests executed)');
  });

  it('fails a run with a broken test file when no threshold is set', async () => {
    await writeProject({ 'broken.yaml': BROKEN_TEST });

    const code = await runCommand({ cwd: dir, tags: [] });

    expect(code).toBe(EXIT_FAILED);
    expect(out()).toContain('Score: 0');
  });

  it('lets the threshold replace the all-must-pass rule', async () => {
    await writeProject({ 'broken.yaml': BROKEN_TEST });

    // Same run as above (score 0), but a threshold of 0 tolerates it: proof the
    // gate takes over the decision rather than adding to it (design D4).
    const code = await runCommand({ cwd: dir, tags: [], minScore: 0 });

    expect(code).toBe(EXIT_OK);
    expect(out()).toContain('min-score 0: pass');
  });

  it('exits 1 when the score is below the threshold', async () => {
    await writeProject({ 'broken.yaml': BROKEN_TEST });

    const code = await runCommand({ cwd: dir, tags: [], minScore: 80 });

    expect(code).toBe(EXIT_FAILED);
    expect(out()).toContain('min-score 80: FAIL');
  });

  it('passes the gate when nothing executed', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockResolvedValue(['docs/guide.md']);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true, minScore: 100 });

    expect(code).toBe(EXIT_OK);
    expect(launchMock).not.toHaveBeenCalled();
  });
});

describe('runCommand --junit', () => {
  it('writes nothing when the flag is absent', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });

    await runCommand({ cwd: dir, tags: [], query: 'no match' });

    await expect(readdir(path.join(dir, '.blastproof', 'reports'))).rejects.toThrow();
  });

  it('writes to the session directory by default', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });

    const code = await runCommand({ cwd: dir, tags: [], query: 'no match', junit: true });

    expect(code).toBe(EXIT_OK);
    const sessions = await readdir(path.join(dir, '.blastproof', 'reports'));
    expect(sessions).toHaveLength(1);
    const xml = await readFile(
      path.join(dir, '.blastproof', 'reports', sessions[0]!, 'junit.xml'),
      'utf8',
    );
    expect(xml).toContain('<testsuite name="blastproof"');
    expect(xml).toContain('<property name="score" value="100"/>');
    expect(out()).toContain('JUnit report:');
  });

  it('writes to an explicit path, creating parent directories', async () => {
    await writeProject({ 'broken.yaml': BROKEN_TEST });

    const code = await runCommand({
      cwd: dir,
      tags: [],
      junit: path.join('build', 'reports', 'e2e.xml'),
    });

    expect(code).toBe(EXIT_FAILED);
    const xml = await readFile(path.join(dir, 'build', 'reports', 'e2e.xml'), 'utf8');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('<property name="score" value="0"/>');
  });

  it('emits unrouted tests as skipped cases under --impacted', async () => {
    await writeProject({ 'cart.yaml': CART_TEST, 'legacy.yaml': UNROUTED_TEST });
    getChangedFilesMock.mockResolvedValue(['docs/guide.md']);

    await runCommand({ cwd: dir, tags: [], impacted: true, junit: 'junit.xml' });

    const xml = await readFile(path.join(dir, 'junit.xml'), 'utf8');
    expect(xml).toContain('skipped="1"');
    expect(xml).toContain('name="Legacy test"');
    expect(xml).toContain('<skipped message="no routes: declared, skipped by --impacted"/>');
  });
});

describe('config precedence: flag > env > file', () => {
  const withEnv = async <T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  it('uses the file when nothing else is set', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });

    const code = await runCommand({ cwd: dir, tags: [], dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(out()).toContain('base_url=http://localhost:4173');
  });

  it('lets the environment beat the file', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });

    const code = await withEnv({ BLASTPROOF_BASE_URL: 'https://from-env.example.com' }, () =>
      runCommand({ cwd: dir, tags: [], dryRun: true }),
    );

    expect(code).toBe(EXIT_OK);
    expect(out()).toContain('base_url=https://from-env.example.com');
  });

  it('lets the flag beat the environment', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });

    const code = await withEnv({ BLASTPROOF_BASE_URL: 'https://from-env.example.com' }, () =>
      runCommand({
        cwd: dir,
        tags: [],
        dryRun: true,
        url: 'https://from-flag.example.com',
      }),
    );

    expect(code).toBe(EXIT_OK);
    expect(out()).toContain('base_url=https://from-flag.example.com');
    expect(out()).not.toContain('from-env');
  });

  it('surfaces an invalid override as a usage error naming the variable', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });

    const code = await withEnv({ BLASTPROOF_LLM_PROVIDER: 'gemini' }, () =>
      runCommand({ cwd: dir, tags: [] }),
    );

    expect(code).toBe(EXIT_USAGE);
    expect(errOut()).toContain('BLASTPROOF_LLM_PROVIDER');
    expect(launchMock).not.toHaveBeenCalled();
  });
});

describe('resolveBudgetOptions precedence: flag > env > file (spec run-budget)', () => {
  it('is unbound when nothing is configured — inert by default', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    const config = await loadConfig(dir);

    const resolved = resolveBudgetOptions(config, {});

    expect(resolved).toEqual({ maxCalls: undefined, maxTokens: undefined, maxDurationMs: undefined });
  });

  it('uses the file when nothing else is set', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    await writeFile(
      path.join(dir, '.blastproof', 'config.yaml'),
      'base_url: http://localhost:4173\nbudget:\n  max_llm_calls: 500\n  max_duration_s: 60\n',
    );
    const config = await loadConfig(dir);

    const resolved = resolveBudgetOptions(config, {});

    expect(resolved.maxCalls).toBe(500);
    expect(resolved.maxDurationMs).toBe(60_000);
  });

  it('lets the environment beat the file', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    await writeFile(
      path.join(dir, '.blastproof', 'config.yaml'),
      'base_url: http://localhost:4173\nbudget:\n  max_llm_calls: 500\n',
    );
    const config = await loadConfig(dir, { BLASTPROOF_MAX_LLM_CALLS: '20' });

    const resolved = resolveBudgetOptions(config, {});

    expect(resolved.maxCalls).toBe(20);
  });

  it('lets the flag beat both the environment and the file', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    await writeFile(
      path.join(dir, '.blastproof', 'config.yaml'),
      'base_url: http://localhost:4173\nbudget:\n  max_llm_calls: 500\n',
    );
    const config = await loadConfig(dir, { BLASTPROOF_MAX_LLM_CALLS: '20' });

    const resolved = resolveBudgetOptions(config, { maxLlmCalls: 3 });

    expect(resolved.maxCalls).toBe(3);
  });

  it('converts the seconds flag/config to milliseconds for the budget', () => {
    const config = { budget: undefined } as unknown as Parameters<typeof resolveBudgetOptions>[0];

    const resolved = resolveBudgetOptions(config, { maxDuration: 30 });

    expect(resolved.maxDurationMs).toBe(30_000);
  });
});

describe('runCommand --html', () => {
  it('writes nothing when the flag is absent', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });

    await runCommand({ cwd: dir, tags: [], query: 'no match' });

    await expect(readdir(path.join(dir, '.blastproof', 'reports'))).rejects.toThrow();
  });

  it('writes to the session directory by default', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });

    const code = await runCommand({ cwd: dir, tags: [], query: 'no match', html: true });

    expect(code).toBe(EXIT_OK);
    const sessions = await readdir(path.join(dir, '.blastproof', 'reports'));
    const html = await readFile(
      path.join(dir, '.blastproof', 'reports', sessions[0]!, 'report.html'),
      'utf8',
    );
    expect(html).toContain('blastproof report');
    expect(out()).toContain('HTML report:');
  });

  it('writes both reports when both flags are given', async () => {
    await writeProject({ 'broken.yaml': BROKEN_TEST });

    const code = await runCommand({
      cwd: dir,
      tags: [],
      junit: 'junit.xml',
      html: path.join('build', 'report.html'),
    });

    expect(code).toBe(EXIT_FAILED);
    await expect(readFile(path.join(dir, 'junit.xml'), 'utf8')).resolves.toContain('<testsuite');
    await expect(
      readFile(path.join(dir, 'build', 'report.html'), 'utf8'),
    ).resolves.toContain('<b>0</b>');
  });
});

describe('runCommand --fail-on-unmapped', () => {
  async function writeProjectWithIgnore(): Promise<void> {
    const config = [
      'base_url: http://localhost:4173',
      'llm:',
      '  provider: anthropic',
      '  api_key_env: BLASTPROOF_TEST_MISSING_KEY',
      'routes:',
      '  "src/cart/**": ["/cart"]',
      'ignore:',
      '  - "**/*.md"',
      '',
    ].join('\n');
    await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
    await writeFile(path.join(dir, '.blastproof', 'config.yaml'), config);
    await writeFile(path.join(dir, '.blastproof', 'tests', 'cart.yaml'), CART_TEST);
  }

  it('blocks an unclassified file and names both resolutions', async () => {
    await writeProjectWithIgnore();
    getChangedFilesMock.mockResolvedValue(['src/lib/money.ts']);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true, failOnUnmapped: true });

    expect(code).toBe(EXIT_FAILED);
    expect(errOut()).toContain('src/lib/money.ts');
    expect(errOut()).toContain('routes:');
    expect(errOut()).toContain('ignore:');
  });

  it('does not block on ignored files', async () => {
    await writeProjectWithIgnore();
    getChangedFilesMock.mockResolvedValue(['README.md', 'docs/guide.md']);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true, failOnUnmapped: true });

    expect(code).toBe(EXIT_OK);
  });

  it('is additive: blocks even when the score gate passes', async () => {
    await writeProjectWithIgnore();
    getChangedFilesMock.mockResolvedValue(['src/lib/money.ts']);

    // Nothing executed, so the score is 100 and min-score 80 is satisfied.
    const code = await runCommand({
      cwd: dir,
      tags: [],
      impacted: true,
      minScore: 80,
      failOnUnmapped: true,
    });

    expect(code).toBe(EXIT_FAILED);
  });

  it('leaves the exit code untouched without the flag', async () => {
    await writeProjectWithIgnore();
    getChangedFilesMock.mockResolvedValue(['src/lib/money.ts']);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true });

    expect(code).toBe(EXIT_OK);
    expect(out()).toContain('Unclassified files');
  });
});

describe('runCommand route drift warning', () => {
  // Declares "/cart/" with a trailing slash, which config's writeProject maps to
  // "/cart" — so this route contributes nothing to --impacted selection (exact equality).
  const DRIFT_TEST = `summary: Cart trailing slash
routes: ["/cart/"]
steps:
  - apply a discount
`;

  it('warns on stderr in --impacted --dry-run and stays non-fatal', async () => {
    await writeProject({ 'drift.yaml': DRIFT_TEST });
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts']);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true, dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(errOut()).toContain('Route drift');
    expect(errOut()).toContain('/cart/');
    expect(errOut()).toContain('Cart trailing slash');
    expect(errOut()).toContain('declared by no routes: mapping');
    expect(errOut()).toContain('contribute nothing to --impacted selection');
    expect(errOut().match(/Route drift/g)?.length).toBe(1);
  });

  it('warns on stderr in --dry-run without --impacted (drift is diff-independent)', async () => {
    await writeProject({ 'drift.yaml': DRIFT_TEST });

    const code = await runCommand({ cwd: dir, tags: [], dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(getChangedFilesMock).not.toHaveBeenCalled();
    expect(errOut()).toContain('Route drift');
    expect(errOut()).toContain('/cart/');
    expect(errOut()).toContain('declared by no routes: mapping');
  });

  it('does not warn when test routes match config exactly', async () => {
    await writeProject({ 'cart.yaml': CART_TEST });
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts']);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true, dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(errOut()).not.toContain('Route drift');
  });

  it('does not warn when config has no routes: mappings (D4)', async () => {
    // A suite using routes as metadata with no mappings is not flagged.
    const config = [
      'base_url: http://localhost:4173',
      'llm:',
      '  provider: anthropic',
      '  api_key_env: BLASTPROOF_TEST_MISSING_KEY',
      '',
    ].join('\n');
    await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
    await writeFile(path.join(dir, '.blastproof', 'config.yaml'), config);
    await writeFile(
      path.join(dir, '.blastproof', 'tests', 'cart.yaml'),
      'summary: Cart\nroutes: ["/cart"]\nsteps:\n  - do a thing\n',
    );

    const code = await runCommand({ cwd: dir, tags: [], dryRun: true });

    expect(code).toBe(EXIT_OK);
    expect(errOut()).not.toContain('Route drift');
  });

  it('includes the drift warning in the --impacted report', async () => {
    await writeProject({ 'drift.yaml': DRIFT_TEST });
    getChangedFilesMock.mockResolvedValue(['src/cart/discount.ts']);

    const code = await runCommand({ cwd: dir, tags: [], impacted: true });

    expect(code).toBe(EXIT_OK);
    expect(errOut()).toContain('Route drift');
    expect(errOut()).toContain('Cart trailing slash');
    expect(errOut()).toContain('/cart/');
  });
});
