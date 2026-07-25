import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-config-'));
  await mkdir(path.join(dir, '.blastproof'), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeConfig(content: string): Promise<void> {
  await writeFile(path.join(dir, '.blastproof', 'config.yaml'), content);
}

describe('loadConfig', () => {
  it('loads a minimal valid config with defaults', async () => {
    await writeConfig('base_url: http://localhost:3000\n');
    const config = await loadConfig(dir);
    expect(config.base_url).toBe('http://localhost:3000');
    expect(config.llm.provider).toBe('anthropic');
    expect(config.browser.headless).toBe(true);
    expect(config.browser.timeout_ms).toBe(30_000);
    expect(config.max_retries_per_step).toBe(3);
  });

  it('loads a full config', async () => {
    await writeConfig(
      [
        'base_url: http://localhost:3000',
        'llm:',
        '  provider: ollama',
        '  model: qwen2.5',
        '  base_url: http://localhost:11434/v1',
        'browser:',
        '  headless: false',
        'routes:',
        '  "src/auth/**": ["/login"]',
        'max_retries_per_step: 5',
        '',
      ].join('\n'),
    );
    const config = await loadConfig(dir);
    expect(config.llm.provider).toBe('ollama');
    expect(config.llm.model).toBe('qwen2.5');
    expect(config.llm.base_url).toBe('http://localhost:11434/v1');
    expect(config.browser.headless).toBe(false);
    expect(config.routes).toEqual({ 'src/auth/**': ['/login'] });
    expect(config.max_retries_per_step).toBe(5);
  });

  it('fails with an actionable error when config is missing', async () => {
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/blastproof init/);
  });

  it('fails on invalid YAML', async () => {
    await writeConfig('base_url: [unclosed\n');
    await expect(loadConfig(dir)).rejects.toThrow(/Invalid YAML/);
  });

  it('names the offending field on schema violations', async () => {
    await writeConfig('base_url: not-a-url\n');
    await expect(loadConfig(dir)).rejects.toThrow(/base_url/);
  });

  it('rejects unknown llm providers', async () => {
    await writeConfig('base_url: http://localhost:3000\nllm:\n  provider: gemini\n');
    await expect(loadConfig(dir)).rejects.toThrow(/llm\.provider/);
  });
});
