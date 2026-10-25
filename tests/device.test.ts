import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { launchMock, createBrainMock, executeTestMock } = vi.hoisted(() => ({
  launchMock: vi.fn(),
  createBrainMock: vi.fn(),
  executeTestMock: vi.fn(),
}));

// The real registry, a fake launch: the device names are Playwright's own.
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

import { contextOptions } from '../src/auth.js';
import { EXIT_FAILED, EXIT_OK, runCommand } from '../src/commands/run.js';
import { loadConfig } from '../src/config.js';
import { renderHtml } from '../src/report/html.js';
import { deviceOptions, isDevice, unknownDeviceMessage } from '../src/runner/device.js';
import type { TestResult } from '../src/runner/executor.js';
import { parseTestFile } from '../src/runner/testfile.js';

const CAPTURED = { cookies: [{ name: 'session', value: 'abc' }], origins: [] };

let dir: string;
let logs: string[];
let errors: string[];
let contextOptionsSeen: Record<string, unknown>[];

const out = (): string => logs.join('\n');

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
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-device-'));
  await mkdir(path.join(dir, '.blastproof', 'tests'), { recursive: true });
  logs = [];
  errors = [];
  contextOptionsSeen = [];
  launchMock.mockReset();
  createBrainMock.mockReset();
  executeTestMock.mockReset();
  launchMock.mockResolvedValue(browserDouble());
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
  createBrainMock.mockReturnValue({ nextAction: vi.fn(), judge: vi.fn() });
  executeTestMock.mockImplementation(async (_page: unknown, test: { path: string; summary: string }) => ({
    file: test.path,
    summary: test.summary,
    priority: 'P1',
    tags: [],
    status: 'passed' as const,
    steps: [],
    durationMs: 10,
  }));
  process.env.BLASTPROOF_DEVICE_TEST_KEY = 'key';
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
  delete process.env.BLASTPROOF_DEVICE_TEST_KEY;
  await rm(dir, { recursive: true, force: true });
});

async function writeProject(config: string, tests: Record<string, string>): Promise<void> {
  await writeFile(
    path.join(dir, '.blastproof', 'config.yaml'),
    [
      'base_url: http://localhost:4173',
      'llm:',
      '  provider: anthropic',
      '  api_key_env: BLASTPROOF_DEVICE_TEST_KEY',
      config,
    ].join('\n'),
  );
  for (const [name, content] of Object.entries(tests)) {
    await writeFile(path.join(dir, '.blastproof', 'tests', name), content);
  }
}

const DESKTOP = 'summary: Desktop page\nsteps:\n  - open the home page\n';
const PHONE = 'summary: Phone menu\ndevice: Pixel 7\nsteps:\n  - open the menu\n';

describe('the device registry (design a-test-names-its-device, D1, D2)', () => {
  it('knows Playwright\'s names, case and all', () => {
    expect(isDevice('Pixel 7')).toBe(true);
    expect(isDevice('pixel 7')).toBe(false);
    expect(isDevice('toString')).toBe(false);
  });

  it('suggests names containing every word given, without landscape variants', () => {
    const message = unknownDeviceMessage('iphone 15');
    expect(message).toContain('"iphone 15" is not a device Playwright knows');
    expect(message).toMatch(/"iPhone 15[^"]*"/);
    expect(message).not.toContain('landscape');
  });

  it('names the device a name differs from only in case', () => {
    expect(unknownDeviceMessage('pixel 7')).toContain('did you mean "Pixel 7"? Names are case-sensitive');
  });

  it('points to the registry when nothing resembles the name', () => {
    expect(unknownDeviceMessage('toaster')).toMatch(/deviceDescriptorsSource\.json/);
  });

  it('gives a device\'s context options without the browser type, and none without a device', () => {
    expect(deviceOptions(undefined)).toEqual({});
    const options = deviceOptions('Pixel 7');
    expect(options).toMatchObject({ viewport: { width: 412 }, isMobile: true, hasTouch: true });
    expect(options).not.toHaveProperty('defaultBrowserType');
  });

  it('seeds a phone\'s context with the session, and gives none to a context without one', () => {
    const session = { storageState: CAPTURED } as unknown as Parameters<typeof contextOptions>[0];
    expect(contextOptions(session, 'Pixel 7')).toMatchObject({ storageState: CAPTURED, isMobile: true });
    expect(contextOptions(undefined, 'Pixel 7')).toMatchObject({ isMobile: true });
    expect(contextOptions(undefined, 'Pixel 7')).not.toHaveProperty('storageState');
  });
});

describe('naming a device (spec device-emulation, yaml-test-format, config-overrides)', () => {
  it('leaves browser.device unset unless configured', async () => {
    await writeProject('', {});
    expect((await loadConfig(dir, {})).browser.device).toBeUndefined();
  });

  it('accepts browser.device from the registry', async () => {
    await writeProject('browser:\n  device: iPhone 15\n', {});
    expect((await loadConfig(dir, {})).browser.device).toBe('iPhone 15');
  });

  it('rejects a misspelled browser.device, naming the field and a suggestion', async () => {
    await writeProject('browser:\n  device: iphone\n', {});
    await expect(loadConfig(dir, {})).rejects.toThrow(/browser\.device[\s\S]*"iPhone 1\d/);
  });

  it('takes the device from BLASTPROOF_BROWSER_DEVICE', async () => {
    await writeProject('', {});
    expect((await loadConfig(dir, { BLASTPROOF_BROWSER_DEVICE: 'Pixel 7' })).browser.device).toBe('Pixel 7');
  });

  it('rejects an unknown device from the environment, naming the variable', async () => {
    await writeProject('', {});
    await expect(loadConfig(dir, { BLASTPROOF_BROWSER_DEVICE: 'phone' })).rejects.toThrow(
      /BLASTPROOF_BROWSER_DEVICE/,
    );
  });

  it('reads a test file\'s device, and none when it names none', async () => {
    await writeProject('', { 'phone.yaml': PHONE, 'desktop.yaml': DESKTOP });
    const tests = path.join(dir, '.blastproof', 'tests');
    expect((await parseTestFile(path.join(tests, 'phone.yaml'))).device).toBe('Pixel 7');
    expect((await parseTestFile(path.join(tests, 'desktop.yaml'))).device).toBeUndefined();
  });

  it('rejects a test file\'s unknown device, naming the file and the field', async () => {
    await writeProject('', { 'bad.yaml': 'summary: x\ndevice: Pixel Seven\nsteps:\n  - y\n' });
    await expect(parseTestFile(path.join(dir, '.blastproof', 'tests', 'bad.yaml'))).rejects.toThrow(
      /bad\.yaml[\s\S]*device/,
    );
  });
});

describe('running as the device (spec device-emulation)', () => {
  it('runs a phone test beside a desktop one, and names the device in its header', async () => {
    await writeProject('', { 'a-desktop.yaml': DESKTOP, 'b-phone.yaml': PHONE });

    expect(await runCommand({ cwd: dir, tags: [] })).toBe(EXIT_OK);

    expect(contextOptionsSeen).toHaveLength(2);
    expect(contextOptionsSeen[0]).toEqual({});
    expect(contextOptionsSeen[1]).toMatchObject({ viewport: { width: 412 }, isMobile: true, hasTouch: true });
    expect(out()).toContain('> Phone menu [P1] [Pixel 7] (');
    expect(out()).toContain('> Desktop page [P1] (');
  });

  it('gives every test the run\'s device, and lets a test bring itself back to the desktop', async () => {
    await writeProject('browser:\n  device: Pixel 7\n', {
      'a.yaml': DESKTOP,
      'b.yaml': 'summary: Wide page\ndevice: Desktop Chrome\nsteps:\n  - open it\n',
    });

    expect(await runCommand({ cwd: dir, tags: [] })).toBe(EXIT_OK);

    expect(contextOptionsSeen[0]).toMatchObject({ isMobile: true });
    expect(contextOptionsSeen[1]).toMatchObject({ isMobile: false, viewport: { width: 1280 } });
  });

  it('logs in on the run\'s device and seeds a phone test with the session', async () => {
    await writeProject('auth:\n  steps:\n    - sign in\n', { 'phone.yaml': PHONE });

    expect(await runCommand({ cwd: dir, tags: [] })).toBe(EXIT_OK);

    // The login on the desktop default, then the test on the phone, signed in.
    expect(contextOptionsSeen).toHaveLength(2);
    expect(contextOptionsSeen[0]).toEqual({});
    expect(contextOptionsSeen[1]).toMatchObject({ storageState: CAPTURED, isMobile: true });
  });

  it('logs in as browser.device when one is configured', async () => {
    await writeProject('browser:\n  device: iPhone 15\nauth:\n  steps:\n    - sign in\n', { 'a.yaml': DESKTOP });

    expect(await runCommand({ cwd: dir, tags: [] })).toBe(EXIT_OK);

    expect(contextOptionsSeen[0]).toMatchObject({ isMobile: true, viewport: { width: 393 } });
  });

  it('fails a test naming an unknown device, like any broken test file, and opens no page for it', async () => {
    await writeProject('', { 'bad.yaml': 'summary: x\ndevice: Pixel Seven\nsteps:\n  - y\n' });

    expect(await runCommand({ cwd: dir, tags: [] })).toBe(EXIT_FAILED);
    expect(contextOptionsSeen).toHaveLength(0);
    expect(out()).toMatch(/device[\s\S]*"Pixel Seven" is not a device Playwright knows/);
  });
});

describe('the HTML report (design D5)', () => {
  const result = (device?: string): TestResult => ({
    file: 'phone.yaml',
    summary: 'Phone menu',
    priority: 'P1',
    tags: [],
    status: 'passed',
    steps: [],
    durationMs: 1,
    ...(device ? { device } : {}),
  });

  it('names the device beside the priority, and nothing without one', async () => {
    const meta = { score: 100, durationMs: 1, screenshots: 'embed' as const };
    expect(await renderHtml([result('Pixel 7')], [], meta)).toContain('P1 · Pixel 7 · phone.yaml');
    expect(await renderHtml([result()], [], meta)).toContain('P1 · phone.yaml');
  });
});
