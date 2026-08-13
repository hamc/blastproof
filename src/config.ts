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
  /**
   * Bounds every wait: resolving a target element on the accessibility tree, and
   * navigating. An explicit per-call Playwright timeout always overrides
   * `page.setDefaultTimeout()`, so this must be threaded through the action
   * context rather than relied on ambiently (design D2, runner/actions.ts).
   */
  timeout_ms: z.number().int().positive().default(30_000),
  /**
   * Caps accessibility-tree lines sent to the model per snapshot. Optional:
   * undefined lets `runner/snapshot.ts`'s own default (200) apply, so a config
   * that never mentions this behaves exactly as before it existed.
   */
  max_snapshot_lines: z.number().int().positive().optional(),
});

/**
 * A run's budget and deadline (spec run-budget). Every field is optional and
 * independent; an absent field never binds, so a run with no `budget:` section
 * at all behaves exactly as it does today (design: inert by default). Coerced
 * from strings too, since an env override (`BLASTPROOF_MAX_*`) arrives as text.
 */
const budgetSchema = z.object({
  max_llm_calls: z.coerce.number().int().positive().optional(),
  max_tokens: z.coerce.number().int().positive().optional(),
  /** Seconds, not milliseconds, to match how a human would set a deadline. */
  max_duration_s: z.coerce.number().positive().optional(),
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

/**
 * A route as a URL path: a leading slash and no glob metacharacter. `routes:`
 * globs are repository-relative (`src/cart/**`), so the leading slash is what
 * tells the two shapes apart.
 */
const ROUTE_SHAPED = /^\/[^*?]*$/;

/**
 * A source path, or a glob over one: a wildcard, or any file extension.
 *
 * Deliberately not a list of known extensions. The first version of this check
 * enumerated `.ts`, `.vue`, `.py` and a dozen more, and missed the very first
 * real config it was pointed at — this repository's own, whose sources are
 * `.html`. Enumerating the world's file types is a losing game; a trailing
 * extension is the property that actually distinguishes a file from a route.
 */
const FILE_SHAPED = /[*?]|\.[a-z0-9]{1,8}$/i;

/**
 * Keys of `routes:` entries written the other way round — a route mapped to the
 * files behind it, rather than a file glob mapped to the routes it can reach.
 *
 * The inverted form type-checks perfectly: both halves are still a string keying
 * a list of strings, so it parses, and then every changed file matches nothing.
 * The whole diff is reported as unclassified, `--impacted` selects no tests, and
 * the run is green having exercised nothing — the failure looks exactly like a
 * diff that affected no page. Nor is writing it inverted carelessness: the key
 * is named `routes`, and a test file's own `routes:` genuinely *is* a list of
 * routes (`runner/testfile.ts`), so the two meanings sit one file apart.
 *
 * Both halves must look wrong before this accuses. A route may legitimately hold
 * a wildcard (`/products/*`), and that on its own proves nothing.
 */
export interface InvertedRouteEntry {
  /** The key, which reads as a route rather than as a file glob. */
  key: string;
  /** The first value under it reading as a source path — the correction's other half. */
  file: string;
}

export function findInvertedRouteEntries(routes: Record<string, string[]>): InvertedRouteEntry[] {
  const inverted: InvertedRouteEntry[] = [];
  for (const [key, values] of Object.entries(routes)) {
    if (!ROUTE_SHAPED.test(key)) continue;
    const file = values.find((value) => FILE_SHAPED.test(value));
    if (file !== undefined) inverted.push({ key, file });
  }
  return inverted;
}

const configSchema = z.object({
  base_url: z.string().url(),
  llm: llmSchema.default({}),
  browser: browserSchema.default({}),
  routes: z
    .record(z.array(z.string()))
    .superRefine((value, ctx) => {
      const inverted = findInvertedRouteEntries(value);
      const first = inverted[0];
      if (!first) return;
      // Refusing is the point: accepting it produces a green run that selected no
      // tests, which reads as "nothing was affected" rather than as a broken map.
      const others = inverted.length > 1 ? ` (and ${inverted.length - 1} more)` : '';
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `is the wrong way round${others} — the key is the file glob, the value is the routes it affects.\n` +
          `      found:    "${first.key}": ["${first.file}"]\n` +
          `      expected: "${first.file}": ["${first.key}"]`,
      });
    })
    .optional(),
  /** Globs for files knowingly irrelevant to any route (docs, CI config, licences). */
  ignore: z.array(z.string()).optional(),
  /**
   * Origins the agent may navigate to besides `base_url`'s own — a separate auth
   * host, a payment provider. Crossing to a third party during a test is a real
   * decision and belongs in a reviewed file, not in a model's choice (design D1).
   */
  allowed_origins: z.array(z.string().url()).optional(),
  auth: authSchema.optional(),
  max_retries_per_step: z.number().int().min(1).default(3),
  /**
   * How many tests may run at once (design tests-in-parallel, D1). Defaults to
   * 1 — tests are journeys driven against one running application, and whether
   * two of them can run at the same time is a property of that application and
   * those tests, not of the runner. Opted into by the person who knows.
   */
  concurrency: z.number().int().min(1, 'concurrency must be at least 1').default(1),
  budget: budgetSchema.optional(),
});

export type BlastproofConfig = z.infer<typeof configSchema>;
export type LlmConfig = BlastproofConfig['llm'];
export type BrowserConfig = BlastproofConfig['browser'];
export type AuthConfig = NonNullable<BlastproofConfig['auth']>;
export type BudgetConfig = NonNullable<BlastproofConfig['budget']>;

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
  BLASTPROOF_MAX_LLM_CALLS: ['budget', 'max_llm_calls'],
  BLASTPROOF_MAX_TOKENS: ['budget', 'max_tokens'],
  BLASTPROOF_MAX_DURATION_S: ['budget', 'max_duration_s'],
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

/** Unwraps `.optional()`, `.default()` and `.superRefine()` (which `authSchema`
 *  uses) down to the plain object schema underneath, or `undefined` when the
 *  field isn't an object at all (a string, a record, an array — nothing to
 *  recurse into). */
function unwrapToObjectSchema(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> | undefined {
  let current: z.ZodTypeAny = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap();
    } else if (current instanceof z.ZodDefault) {
      current = current.removeDefault();
    } else if (current instanceof z.ZodEffects) {
      current = current.innerType();
    } else {
      break;
    }
  }
  return current instanceof z.ZodObject ? current : undefined;
}

/**
 * Finds keys present in `data` that `schema` does not recognise, recursing into
 * nested sections (`llm`, `browser`, `budget`, `auth` — design task 3.2) so a key
 * misplaced inside one of them is caught too. `routes:` is a `z.record` (behind a
 * refinement), not a `z.object`, so its keys (route globs, not schema fields) are
 * deliberately never flagged: `unwrapToObjectSchema` unwraps the refinement and
 * then only recurses into an actual object schema.
 */
export function findUnknownConfigKeys(
  data: unknown,
  schema: z.ZodTypeAny = configSchema,
  path: string[] = [],
): string[] {
  const object = unwrapToObjectSchema(schema);
  if (!object || data === null || typeof data !== 'object' || Array.isArray(data)) return [];

  const shape = object.shape;
  const warnings: string[] = [];
  for (const key of Object.keys(data as Record<string, unknown>)) {
    const fieldPath = [...path, key];
    const fieldSchema = shape[key];
    if (!fieldSchema) {
      warnings.push(fieldPath.join('.'));
      continue;
    }
    warnings.push(...findUnknownConfigKeys((data as Record<string, unknown>)[key], fieldSchema, fieldPath));
  }
  return warnings;
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

  const source =
    applied.length > 0
      ? `${CONFIG_RELATIVE_PATH} (with overrides from ${applied.join(', ')})`
      : CONFIG_RELATIVE_PATH;

  const result = configSchema.safeParse(merged);
  if (!result.success) {
    // The file may be perfectly valid and an override the culprit; saying only
    // "invalid config.yaml" would send the user hunting through a correct file.
    throw new ConfigError(`Invalid ${source}:\n${formatIssues(result.error)}`);
  }

  // An unknown key is silently discarded by a plain z.object (design D5, spec
  // preflight): a config written for a newer blastproof must still run on an
  // older one, so this warns and keeps going rather than failing.
  for (const key of findUnknownConfigKeys(merged)) {
    console.warn(
      `warning: unknown config key '${key}' in ${source} — this version of blastproof does not ` +
        'recognise it, so it has no effect.',
    );
  }

  return result.data;
}
