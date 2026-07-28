import { describe, expect, it } from 'vitest';
import {
  createModel,
  DEFAULT_MODELS,
  MissingApiKeyError,
} from '../src/llm/provider.js';

describe('createModel', () => {
  it('uses documented default models per provider', () => {
    const anthropic = createModel(
      { provider: 'anthropic' },
      { ANTHROPIC_API_KEY: 'sk-ant-test' },
    );
    expect(anthropic.modelId).toBe(DEFAULT_MODELS.anthropic);
    expect(anthropic.provider).toBe('anthropic');

    const openai = createModel({ provider: 'openai' }, { OPENAI_API_KEY: 'sk-test' });
    expect(openai.modelId).toBe(DEFAULT_MODELS.openai);

    const ollama = createModel({ provider: 'ollama' }, {});
    expect(ollama.modelId).toBe(DEFAULT_MODELS.ollama);
  });

  it('honours an explicit model override', () => {
    const resolved = createModel(
      { provider: 'anthropic', model: 'claude-opus-4-1' },
      { ANTHROPIC_API_KEY: 'sk-ant-test' },
    );
    expect(resolved.modelId).toBe('claude-opus-4-1');
  });

  it('honours a custom api_key_env', () => {
    const resolved = createModel(
      { provider: 'openai', api_key_env: 'MY_OPENAI_KEY' },
      { MY_OPENAI_KEY: 'sk-test' },
    );
    expect(resolved.provider).toBe('openai');
  });

  it('fails fast naming the missing variable when the key is unset', () => {
    const err = (() => {
      try {
        createModel({ provider: 'anthropic' }, {});
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(MissingApiKeyError);
    expect((err as Error).message).toContain('ANTHROPIC_API_KEY');
  });

  it('requires no key for ollama and points at the OpenAI-compatible chat endpoint', () => {
    const resolved = createModel(
      { provider: 'ollama', base_url: 'http://192.168.1.10:11434/v1' },
      {},
    );
    expect(resolved.provider).toBe('ollama');
    const model = resolved.model as { provider?: string };
    expect(model.provider).toBe('openai.chat');
  });

  it('uses Chat Completions for openai so OpenAI-compatible endpoints (e.g. OpenRouter) work via base_url', () => {
    const resolved = createModel(
      { provider: 'openai', base_url: 'https://openrouter.ai/api/v1', api_key_env: 'OPENROUTER_API_KEY' },
      { OPENROUTER_API_KEY: 'sk-or-test' },
    );
    const model = resolved.model as { provider?: string };
    expect(model.provider).toBe('openai.chat');
  });

  it('directs anthropic at a configured endpoint, not the public API', () => {
    // The untested combination: base_url was exercised with openai and ollama,
    // and anthropic — the one that silently dropped it — never was. Every line
    // of the factory was covered; this pair of values was not.
    const resolved = createModel(
      { provider: 'anthropic', base_url: 'https://proxy.internal/v1', api_key_env: 'ANTHROPIC_API_KEY' },
      { ANTHROPIC_API_KEY: 'sk-ant-test' },
    );
    const model = resolved.model as unknown as { config?: { baseURL?: string } };
    expect(model.config?.baseURL).toBe('https://proxy.internal/v1');
  });

  it('leaves anthropic on its default endpoint when no base_url is set', () => {
    const resolved = createModel(
      { provider: 'anthropic', api_key_env: 'ANTHROPIC_API_KEY' },
      { ANTHROPIC_API_KEY: 'sk-ant-test' },
    );
    const model = resolved.model as unknown as { config?: { baseURL?: string } };
    expect(model.config?.baseURL).not.toBe('https://proxy.internal/v1');
  });
});
