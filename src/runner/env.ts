const ENV_PLACEHOLDER = /\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export class MissingEnvError extends Error {
  constructor(variable: string) {
    super(
      `Environment variable ${variable} is referenced via {{env.${variable}}} but is not set. ` +
        `Export it before running, e.g. \`export ${variable}=...\`.`,
    );
    this.name = 'MissingEnvError';
  }
}

type EnvSource = Record<string, string | undefined>;

/** Substitutes `{{env.VAR}}` placeholders from the environment. Throws MissingEnvError on unset vars. */
export function substituteEnv(text: string, env: EnvSource = process.env): string {
  return text.replace(ENV_PLACEHOLDER, (_match, name: string) => {
    const value = env[name];
    if (value === undefined) {
      throw new MissingEnvError(name);
    }
    return value;
  });
}

/** Returns the names of all env vars referenced by `{{env.VAR}}` placeholders in `text`. */
export function referencedEnvVars(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(ENV_PLACEHOLDER)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces every occurrence of each secret value with `***`. Empty values are ignored. */
export function maskSecrets(text: string, secrets: Iterable<string>): string {
  // Longest first so a short secret never masks inside a longer one (e.g. `demo` inside `demo123`).
  const ordered = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  let masked = text;
  for (const secret of ordered) {
    masked = masked.replace(new RegExp(escapeRegExp(secret), 'g'), '***');
  }
  return masked;
}

/**
 * Stateful masker: register secret values once (e.g. per test), mask all output channels.
 */
export class SecretsMask {
  private readonly secrets = new Set<string>();

  /** Registers the current values of the env vars referenced in `text`. Throws MissingEnvError on unset vars. */
  registerFrom(text: string, env: EnvSource = process.env): void {
    for (const name of referencedEnvVars(text)) {
      const value = env[name];
      if (value === undefined) {
        throw new MissingEnvError(name);
      }
      this.secrets.add(value);
    }
  }

  mask(text: string): string {
    return maskSecrets(text, this.secrets);
  }
}
