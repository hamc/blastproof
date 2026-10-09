import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { LlmConfig } from '../config.js';

/**
 * The model a provider uses when `llm.model` is unset. Each was chosen on the
 * reliability benchmark, whose table is in docs/configuration.md ("Choosing a
 * model"); changing one means running it again (design
 * pick-the-defaults-by-measurement).
 */
export const DEFAULT_MODELS: Record<LlmConfig['provider'], string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-6-luna',
  ollama: 'gpt-oss:20b',
};

export const DEFAULT_API_KEY_ENVS: Record<Exclude<LlmConfig['provider'], 'ollama'>, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';

/**
 * Seconds one model call may take when `llm.timeout_s` is unset (design
 * bound-every-model-call, D2). The longest healthy call is a full answer at the
 * output limit: a gateway's slower providers stream open-weight models at tens of
 * tokens per second, and one such call took more than 120 s in verification. A
 * local model on a CPU, at around 5 tokens per second, needs about 820 s for it.
 * A provider that never answers still stops the run within the default.
 */
export const DEFAULT_TIMEOUT_SECONDS: Record<LlmConfig['provider'], number> = {
  anthropic: 300,
  openai: 300,
  ollama: 900,
};

export function timeoutSeconds(llm: LlmConfig): number {
  return llm.timeout_s ?? DEFAULT_TIMEOUT_SECONDS[llm.provider];
}

/**
 * A `fetch` that merges `extra` under every JSON request body (design
 * route-a-gateway-from-the-config, D1, D2). Shallow, with the SDK's fields
 * winning: routing can be added, and neither the JSON schema nor the output
 * limit can be overridden from the config. A body that is not a JSON object is
 * sent as it is.
 */
export function withExtraBody(extra: Record<string, unknown>, base: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    if (typeof init?.body !== 'string') return base(input, init);
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      return base(input, init);
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return base(input, init);
    return base(input, { ...init, body: JSON.stringify({ ...extra, ...body }) });
  };
}

export class MissingApiKeyError extends Error {
  constructor(variable: string, provider: string) {
    super(
      `Missing API key: environment variable ${variable} is not set (required for provider "${provider}"). ` +
        `Export it before running, e.g. \`export ${variable}=...\`, or change llm.provider / llm.api_key_env in .blastproof/config.yaml.`,
    );
    this.name = 'MissingApiKeyError';
  }
}

export interface ResolvedModel {
  model: LanguageModel;
  provider: LlmConfig['provider'];
  modelId: string;
}

/**
 * Resolves the configured LLM provider to a model instance.
 * Fails fast (before any browser launch) when the required API key env var is unset.
 */
export function createModel(
  llm: LlmConfig,
  env: Record<string, string | undefined> = process.env,
): ResolvedModel {
  const modelId = llm.model ?? DEFAULT_MODELS[llm.provider];

  switch (llm.provider) {
    case 'anthropic':
    case 'openai': {
      const keyEnv = llm.api_key_env ?? DEFAULT_API_KEY_ENVS[llm.provider];
      const apiKey = env[keyEnv];
      if (!apiKey) {
        throw new MissingApiKeyError(keyEnv, llm.provider);
      }
      const baseURL = llm.base_url ? { baseURL: llm.base_url } : {};
      const extra = llm.extra_body ? { fetch: withExtraBody(llm.extra_body) } : {};
      const model =
        llm.provider === 'anthropic'
          ? // A configured endpoint applies to whichever provider is selected —
            // dropping it here routed corporate-proxy configs to the public API
            // with no error (design D2).
            createAnthropic({ apiKey, ...baseURL })(modelId)
          : // `.chat` = Chat Completions: works with official OpenAI and any
            // OpenAI-compatible endpoint (OpenRouter, LiteLLM, vLLM) via base_url.
            createOpenAI({ apiKey, ...baseURL, ...extra }).chat(modelId);
      return { model, provider: llm.provider, modelId };
    }
    case 'ollama': {
      const baseURL = llm.base_url ?? DEFAULT_OLLAMA_BASE_URL;
      // Ollama exposes an OpenAI-compatible Chat Completions endpoint; a dummy key satisfies the client.
      const extra = llm.extra_body ? { fetch: withExtraBody(llm.extra_body) } : {};
      const model = createOpenAI({ baseURL, apiKey: 'ollama', ...extra }).chat(modelId);
      return { model, provider: 'ollama', modelId };
    }
  }
}
