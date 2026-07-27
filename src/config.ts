import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const CONFIG_RELATIVE_PATH = path.join('.blastproof', 'config.yaml');

const llmSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'ollama']).default('anthropic'),
  model: z.string().min(1).optional(),
  api_key_env: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
});

const browserSchema = z.object({
  headless: z.boolean().default(true),
  timeout_ms: z.number().int().positive().default(30_000),
});

const cookieSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
});

/**
 * Authentication recipe. Exactly one strategy, chosen by which field is present
 * (design D2): a plain-English login journey, a previously captured storage state,
 * or static headers/cookies. All three converge on one authenticated session (D1).
 */
const authSchema = z
  .object({
    steps: z.array(z.string().min(1)).min(1).optional(),
    storage_state: z.string().min(1).optional(),
    headers: z.record(z.string()).optional(),
    cookies: z.array(cookieSchema).min(1).optional(),
    verify: z.string().min(1).optional(),
    cache: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const present: string[] = [];
    if (value.steps) present.push('steps');
    if (value.storage_state) present.push('storage_state');
    if (value.headers || value.cookies) {
      present.push([value.headers && 'headers', value.cookies && 'cookies'].filter(Boolean).join('+'));
    }

    if (present.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'configure one auth strategy: steps (login journey), storage_state (captured session), or headers/cookies',
      });
      return;
    }
    if (present.length > 1) {
      // Silently preferring one would make a typo look like it worked.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `configure exactly one auth strategy, found ${present.join(' and ')}`,
      });
    }
  });

const configSchema = z.object({
  base_url: z.string().url(),
  llm: llmSchema.default({}),
  browser: browserSchema.default({}),
  routes: z.record(z.array(z.string())).optional(),
  auth: authSchema.optional(),
  max_retries_per_step: z.number().int().min(1).default(3),
});

export type BlastproofConfig = z.infer<typeof configSchema>;
export type LlmConfig = BlastproofConfig['llm'];
export type BrowserConfig = BlastproofConfig['browser'];
export type AuthConfig = NonNullable<BlastproofConfig['auth']>;

/**
 * Environment overrides, one entry per settable field (design D2). `base_url` (the
 * app under test) and `llm.base_url` (the provider endpoint) are deliberately kept
 * apart by name: silently overriding the wrong one would point the browser at an
 * LLM gateway, and that failure is baffling to debug.
 */
export const ENV_OVERRIDES: Record<string, readonly [string] | readonly [string, string]> = {
  BLASTPROOF_BASE_URL: ['base_url'],
  BLASTPROOF_LLM_PROVIDER: ['llm', 'provider'],
  BLASTPROOF_LLM_MODEL: ['llm', 'model'],
  BLASTPROOF_LLM_BASE_URL: ['llm', 'base_url'],
  BLASTPROOF_LLM_API_KEY_ENV: ['llm', 'api_key_env'],
};

export interface OverrideResult {
  /** Parsed config with environment values merged in, before validation. */
  data: Record<string, unknown>;
  /** Names of the variables that actually contributed, for error attribution. */
  applied: string[];
}

/**
 * Merges environment overrides into the parsed YAML *before* zod runs (design D4),
 * so an invalid override fails with the same actionable error as an invalid file
 * and per-field defaulting still applies. Pure; `env` is injectable for tests.
 * An empty string counts as unset, so `FOO=` in a CI matrix never blanks a value.
 */
export function applyEnvOverrides(
  data: unknown,
  env: Record<string, string | undefined> = process.env,
): OverrideResult {
  const merged: Record<string, unknown> =
    data && typeof data === 'object' ? { ...(data as Record<string, unknown>) } : {};
  const applied: string[] = [];

  for (const [variable, keyPath] of Object.entries(ENV_OVERRIDES)) {
    const value = env[variable];
    if (value === undefined || value === '') continue;

    if (keyPath.length === 1) {
      merged[keyPath[0]!] = value;
    } else {
      const [section, field] = keyPath as [string, string];
      const current = merged[section];
      merged[section] = {
        ...(current && typeof current === 'object' ? (current as Record<string, unknown>) : {}),
        [field]: value,
      };
    }
    applied.push(variable);
  }

  return { data: merged, applied };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * Loads and validates `.blastproof/config.yaml` from `cwd`.
 * Throws ConfigError with an actionable message on any problem.
 */
export async function loadConfig(
  cwd: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Promise<BlastproofConfig> {
  const configPath = path.join(cwd, CONFIG_RELATIVE_PATH);

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch {
    throw new ConfigError(
      `No config found at ${CONFIG_RELATIVE_PATH}. Run \`blastproof init\` to scaffold one.`,
    );
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (error) {
    throw new ConfigError(
      `Invalid YAML in ${CONFIG_RELATIVE_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const { data: merged, applied } = applyEnvOverrides(data ?? {}, env);

  const result = configSchema.safeParse(merged);
  if (!result.success) {
    // The file may be perfectly valid and an override the culprit; saying only
    // "invalid config.yaml" would send the user hunting through a correct file.
    const source =
      applied.length > 0
        ? `${CONFIG_RELATIVE_PATH} (with overrides from ${applied.join(', ')})`
        : CONFIG_RELATIVE_PATH;
    throw new ConfigError(`Invalid ${source}:\n${formatIssues(result.error)}`);
  }
  return result.data;
}
