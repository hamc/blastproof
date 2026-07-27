import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyEnvOverrides, ConfigError, loadConfig } from '../src/config.js';

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

describe('applyEnvOverrides', () => {
  it('is a no-op when no variable is set', () => {
    const { data, applied } = applyEnvOverrides({ base_url: 'http://a' }, {});
    expect(data).toEqual({ base_url: 'http://a' });
    expect(applied).toEqual([]);
  });

  it('treats an empty string as unset', () => {
    const { data, applied } = applyEnvOverrides(
      { llm: { model: 'from-file' } },
      { BLASTPROOF_LLM_MODEL: '' },
    );
    expect((data.llm as Record<string, unknown>).model).toBe('from-file');
    expect(applied).toEqual([]);
  });

  it('merges into a section without dropping its other fields', () => {
    const { data } = applyEnvOverrides(
      { llm: { provider: 'anthropic', api_key_env: 'FROM_FILE' } },
      { BLASTPROOF_LLM_PROVIDER: 'openai' },
    );
    expect(data.llm).toEqual({ provider: 'openai', api_key_env: 'FROM_FILE' });
  });

  it('reports which variables contributed', () => {
    const { applied } = applyEnvOverrides(
      {},
      { BLASTPROOF_LLM_PROVIDER: 'openai', BLASTPROOF_BASE_URL: 'http://x' },
    );
    expect(applied.sort()).toEqual(['BLASTPROOF_BASE_URL', 'BLASTPROOF_LLM_PROVIDER']);
  });
});

describe('loadConfig environment overrides', () => {
  const FILE = [
    'base_url: http://from-file.example.com',
    'llm:',
    '  provider: anthropic',
    '  model: claude-haiku-4-5',
    '  api_key_env: FROM_FILE_KEY',
    '',
  ].join('\n');

  it('overrides each llm field from its variable', async () => {
    await writeConfig(FILE);
    const config = await loadConfig(dir, {
      BLASTPROOF_LLM_PROVIDER: 'openai',
      BLASTPROOF_LLM_MODEL: 'anthropic/claude-haiku-4.5',
      BLASTPROOF_LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      BLASTPROOF_LLM_API_KEY_ENV: 'OPENROUTER_API_KEY',
    });
    expect(config.llm).toEqual({
      provider: 'openai',
      model: 'anthropic/claude-haiku-4.5',
      base_url: 'https://openrouter.ai/api/v1',
      api_key_env: 'OPENROUTER_API_KEY',
    });
  });

  it('leaves the other settings alone when only one field is overridden', async () => {
    await writeConfig(FILE);
    const config = await loadConfig(dir, { BLASTPROOF_LLM_PROVIDER: 'openai' });
    expect(config.llm.provider).toBe('openai');
    expect(config.llm.model).toBe('claude-haiku-4-5');
    expect(config.llm.api_key_env).toBe('FROM_FILE_KEY');
    expect(config.base_url).toBe('http://from-file.example.com');
  });

  it('keeps the app URL and the provider endpoint separate', async () => {
    await writeConfig(FILE);
    const config = await loadConfig(dir, {
      BLASTPROOF_BASE_URL: 'https://preview.example.com',
      BLASTPROOF_LLM_BASE_URL: 'https://openrouter.ai/api/v1',
    });
    expect(config.base_url).toBe('https://preview.example.com');
    expect(config.llm.base_url).toBe('https://openrouter.ai/api/v1');
  });

  it('resolves exactly from the file when no variable is set', async () => {
    await writeConfig(FILE);
    const config = await loadConfig(dir, {});
    expect(config.base_url).toBe('http://from-file.example.com');
    expect(config.llm.provider).toBe('anthropic');
  });

  it('rejects an invalid provider, naming the variable', async () => {
    await writeConfig(FILE);
    await expect(loadConfig(dir, { BLASTPROOF_LLM_PROVIDER: 'gemini' })).rejects.toThrow(
      /BLASTPROOF_LLM_PROVIDER/,
    );
  });

  it('rejects an invalid URL, naming the variable', async () => {
    await writeConfig(FILE);
    await expect(loadConfig(dir, { BLASTPROOF_BASE_URL: 'not-a-url' })).rejects.toThrow(
      /BLASTPROOF_BASE_URL/,
    );
  });

  it('does not blame a valid file when the override is at fault', async () => {
    await writeConfig(FILE);
    // The file alone loads fine, so the message must point at the environment.
    await expect(loadConfig(dir, {})).resolves.toBeDefined();
    const error = await loadConfig(dir, { BLASTPROOF_LLM_PROVIDER: 'gemini' }).catch((e) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).toContain('with overrides from');
  });
});
