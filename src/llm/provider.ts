import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { LlmConfig } from '../config.js';

export const DEFAULT_MODELS: Record<LlmConfig['provider'], string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  ollama: 'qwen2.5',
};

export const DEFAULT_API_KEY_ENVS: Record<Exclude<LlmConfig['provider'], 'ollama'>, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';

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
      const model =
        llm.provider === 'anthropic'
          ? // A configured endpoint applies to whichever provider is selected —
            // dropping it here routed corporate-proxy configs to the public API
            // with no error (design D2).
            createAnthropic({ apiKey, ...baseURL })(modelId)
          : // `.chat` = Chat Completions: works with official OpenAI and any
            // OpenAI-compatible endpoint (OpenRouter, LiteLLM, vLLM) via base_url.
            createOpenAI({ apiKey, ...baseURL }).chat(modelId);
      return { model, provider: llm.provider, modelId };
    }
    case 'ollama': {
      const baseURL = llm.base_url ?? DEFAULT_OLLAMA_BASE_URL;
      // Ollama exposes an OpenAI-compatible Chat Completions endpoint; a dummy key satisfies the client.
      const model = createOpenAI({ baseURL, apiKey: 'ollama' }).chat(modelId);
      return { model, provider: 'ollama', modelId };
    }
  }
}
