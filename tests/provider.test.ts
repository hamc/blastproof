import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrain } from '../src/llm/brain.js';
import {
  createModel,
  DEFAULT_MODELS,
  MissingApiKeyError,
  withExtraBody,
} from '../src/llm/provider.js';
import { RunBudget } from '../src/runner/budget.js';

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

  it('defaults to the models the reliability benchmark chose (docs/configuration.md)', () => {
    expect(DEFAULT_MODELS).toEqual({
      anthropic: 'claude-haiku-4-5',
      openai: 'gpt-6-luna',
      ollama: 'gpt-oss:20b',
    });
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

describe('llm.extra_body (route-a-gateway-from-the-config)', () => {
  function recordingFetch(bodies: unknown[]): typeof fetch {
    return async (_input, init) => {
      const raw = init?.body;
      bodies.push(typeof raw === 'string' && raw.startsWith('{') ? JSON.parse(raw) : raw);
      return new Response('{}');
    };
  }

  it('merges the extra fields under a JSON body, the body winning (D1, D2)', async () => {
    const bodies: unknown[] = [];
    const send = withExtraBody({ provider: { require_parameters: true }, max_tokens: 64000 }, recordingFetch(bodies));
    await send('https://gw.test/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'm', max_tokens: 4096 }),
    });
    expect(bodies[0]).toEqual({ provider: { require_parameters: true }, model: 'm', max_tokens: 4096 });
  });

  it('sends a body that is not a JSON object as it is', async () => {
    const bodies: unknown[] = [];
    const send = withExtraBody({ provider: {} }, recordingFetch(bodies));
    await send('https://gw.test/x', { method: 'POST', body: 'not json' });
    await send('https://gw.test/x', { method: 'GET' });
    expect(bodies).toEqual(['not json', undefined]);
  });

  describe('end to end, through the brain', () => {
    afterEach(() => vi.unstubAllGlobals());

    async function requestBodyFor(llm: Parameters<typeof createModel>[0]): Promise<Record<string, unknown>> {
      const bodies: Record<string, unknown>[] = [];
      vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            id: 'x',
            object: 'chat.completion',
            created: 0,
            model: 'm',
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"outcome":"o","reason":"r","pass":true}' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      });
      const { model } = createModel(llm, { OPENROUTER_API_KEY: 'k' });
      await createBrain(model, undefined, new RunBudget()).judge('verify x', 'x', '');
      return bodies[0]!;
    }

    it('reaches the gateway with the routing, and the output limit intact', async () => {
      const body = await requestBodyFor({
        provider: 'openai',
        model: 'openai/gpt-oss-20b',
        base_url: 'https://openrouter.ai/api/v1',
        api_key_env: 'OPENROUTER_API_KEY',
        extra_body: { provider: { require_parameters: true, ignore: ['Venice'] }, max_tokens: 64000 },
      });
      expect(body.provider).toEqual({ require_parameters: true, ignore: ['Venice'] });
      expect(body.max_tokens ?? body.max_completion_tokens).toBe(4096);
      expect(body.response_format).toBeDefined();
    });

    it('sends nothing extra without it', async () => {
      const body = await requestBodyFor({
        provider: 'openai',
        model: 'm',
        base_url: 'https://openrouter.ai/api/v1',
        api_key_env: 'OPENROUTER_API_KEY',
      });
      expect(body.provider).toBeUndefined();
    });
  });
});
