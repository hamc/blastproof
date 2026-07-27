import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initProject } from '../src/commands/init.js';
import { parseTestFile } from '../src/runner/testfile.js';
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

  it('produces sample tests that actually parse', async () => {
    await initProject(dir);
    const sample = await parseTestFile(at('tests', 'app-load.yaml'));
    expect(sample.routes).toEqual(['/']);

    const login = await parseTestFile(at('tests', 'login.yaml'));
    // A login test must start signed out, or an auth recipe would break it.
    expect(login.auth).toBe(false);
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
});
