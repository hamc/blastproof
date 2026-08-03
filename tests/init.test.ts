import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initProject, InitError } from '../src/commands/init.js';
import { discoverTestFiles, parseTestFile } from '../src/runner/testfile.js';
import { loadConfig } from '../src/config.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-init-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const at = (...parts: string[]): string => path.join(dir, '.blastproof', ...parts);

describe('initProject', () => {
  it('scaffolds a config, sample tests and a gitignore', async () => {
    const result = await initProject(dir);

    expect(result.created).toHaveLength(4);
    await expect(readFile(at('config.yaml'), 'utf8')).resolves.toContain('base_url:');
    await expect(readFile(at('.gitignore'), 'utf8')).resolves.toContain('.auth-state.json');
  });

  it('produces a config that actually loads', async () => {
    await initProject(dir);
    const config = await loadConfig(dir, {});
    expect(config.base_url).toBeTruthy();
    expect(config.llm.provider).toBe('anthropic');
  });

  it('produces a sample test that actually parses', async () => {
    await initProject(dir);
    const sample = await parseTestFile(at('tests', 'app-load.yaml'));
    expect(sample.routes).toEqual(['/']);
  });

  it('scaffolds only tests that can pass against an unknown app', async () => {
    await initProject(dir);
    const discovered = await discoverTestFiles(at('tests'));

    // The login template ships inert. A scaffolded test written for someone
    // else's login would fail on the user's very first run — on a tool whose
    // whole promise is that they need not write tests.
    expect(discovered.map((f) => path.basename(f))).toEqual(['app-load.yaml']);

    const template = await readFile(at('tests', 'login.yaml.example'), 'utf8');
    expect(template).toContain('TEMPLATE');
    // And it models the practice we document rather than hardcoding credentials.
    expect(template).toContain('{{env.TEST_PASSWORD}}');
    expect(template).not.toContain('demo123');
  });

  it('points the scaffolded config at the canonical repository', async () => {
    await initProject(dir);
    const config = await readFile(at('config.yaml'), 'utf8');
    // This link ships to every user and a published version can never be edited,
    // so a dead or third-party-controlled URL must not reach a release.
    expect(config).toContain('https://github.com/hamc/blastproof');
    expect(config).not.toContain('github.com/blastproof/blastproof');
  });

  it('is idempotent and never overwrites an edited file', async () => {
    await mkdir(at('tests'), { recursive: true });
    await writeFile(at('config.yaml'), 'base_url: http://mine.example.com\n');

    const result = await initProject(dir);

    expect(result.kept).toContain(at('config.yaml'));
    await expect(readFile(at('config.yaml'), 'utf8')).resolves.toContain('mine.example.com');
  });

  it('throws InitError with a house-style message when .blastproof is a file, not a directory', async () => {
    // A file where a directory is expected: mkdir fails (ENOTDIR/EEXIST), previously
    // surfacing as a raw Node code instead of the house error style.
    await writeFile(path.join(dir, '.blastproof'), 'not a directory');
    let thrown: unknown;
    try {
      await initProject(dir);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InitError);
    const message = (thrown as Error).message;
    expect(message).toContain('Cannot scaffold');
    expect(message).toContain('.blastproof');
    expect(message).not.toMatch(/\b(EACCES|EISDIR|ENOTDIR|EEXIST|ENOENT|EPERM):/);
    expect(message).toMatch(/not a file/);
  });
});
