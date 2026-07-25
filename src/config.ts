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

const configSchema = z.object({
  base_url: z.string().url(),
  llm: llmSchema.default({}),
  browser: browserSchema.default({}),
  routes: z.record(z.array(z.string())).optional(),
  max_retries_per_step: z.number().int().min(1).default(3),
});

export type BlastproofConfig = z.infer<typeof configSchema>;
export type LlmConfig = BlastproofConfig['llm'];
export type BrowserConfig = BlastproofConfig['browser'];

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
export async function loadConfig(cwd: string = process.cwd()): Promise<BlastproofConfig> {
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

  const result = configSchema.safeParse(data ?? {});
  if (!result.success) {
    throw new ConfigError(`Invalid ${CONFIG_RELATIVE_PATH}:\n${formatIssues(result.error)}`);
  }
  return result.data;
}
