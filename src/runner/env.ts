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

/**
 * The comparison the mask makes (design say-when-the-page-reformatted-a-secret,
 * D1): the value itself, case-insensitively, with each run of whitespace matched
 * as a run of whitespace. It is the normalization this codebase already applies
 * in the other direction — deciding whether a typed value came from the page
 * (spec agentic-execution) — and it is deliberately the whole rule. A value the
 * application re-encodes or hashes produces a string no comparison here can
 * recognise, and enumerating transforms would imply a completeness this cannot
 * have.
 */
export function secretPattern(secret: string): RegExp {
  return new RegExp(escapeRegExp(secret).replace(/\s+/g, '\\s+'), 'gi');
}

/** A registered value and the pattern that finds it, built once per value. */
interface CompiledSecret {
  value: string;
  pattern: RegExp;
}

/** Longest first so a short secret never masks inside a longer one (e.g. `demo` inside `demo123`). */
function compile(secrets: Iterable<string>): CompiledSecret[] {
  return [...secrets]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((value) => ({ value, pattern: secretPattern(value) }));
}

function maskCompiled(
  text: string,
  compiled: readonly CompiledSecret[],
  onNearMiss?: (secret: string, found: string) => void,
): string {
  let masked = text;
  for (const { value, pattern } of compiled) {
    pattern.lastIndex = 0; // `g` regexes are stateful, and these are reused
    masked = masked.replace(pattern, (found) => {
      if (found !== value) onNearMiss?.(value, found);
      return '***';
    });
  }
  return masked;
}

/**
 * Replaces every occurrence of each secret value with `***`. Empty values are
 * ignored. `onNearMiss` is called with the registered value whenever the text
 * replaced was not byte-identical to it — i.e. exactly where a literal,
 * case-sensitive comparison would have left the secret in the text.
 */
export function maskSecrets(
  text: string,
  secrets: Iterable<string>,
  onNearMiss?: (secret: string, found: string) => void,
): string {
  return maskCompiled(text, compile(secrets), onNearMiss);
}

/**
 * Stateful masker: register secret values once (e.g. per test), mask all output channels.
 */
export class SecretsMask {
  private readonly secrets = new Set<string>();
  /** Value -> the `{{env.*}}` variable it came from, so a warning can name it. */
  private readonly names = new Map<string, string>();
  private readonly nearMissed = new Set<string>();
  /** Built on first use after a registration, not on every masked string. */
  private compiled: CompiledSecret[] | undefined;

  /** Registers the current values of the env vars referenced in `text`. Throws MissingEnvError on unset vars. */
  registerFrom(text: string, env: EnvSource = process.env): void {
    for (const name of referencedEnvVars(text)) {
      const value = env[name];
      if (value === undefined) {
        throw new MissingEnvError(name);
      }
      this.add(value, name);
    }
  }

  /**
   * Registers a value and the forms it takes on the way to a prompt. `navigate`
   * reports a resolved URL, and `new URL()` percent-encodes — so a secret with a
   * space stopped matching a literal search and passed through unmasked.
   * This cannot cover every transform a page might apply; see the README.
   */
  add(value: string, name?: string): void {
    if (!value) return;
    this.secrets.add(value);
    this.compiled = undefined;
    // First name wins: two variables holding the same value are the same secret,
    // and a warning naming either one sends the reader to the same place.
    if (name !== undefined && !this.names.has(value)) this.names.set(value, name);
    const encoded = encodeURIComponent(value);
    if (encoded !== value) {
      this.secrets.add(encoded);
      if (name !== undefined && !this.names.has(encoded)) this.names.set(encoded, name);
    }
  }

  mask(text: string): string {
    this.compiled ??= compile(this.secrets);
    return maskCompiled(text, this.compiled, (secret) => {
      const name = this.names.get(secret);
      if (name !== undefined) this.nearMissed.add(name);
    });
  }

  /**
   * The `{{env.*}}` variables whose value was redacted in a form differing from
   * the one supplied — the case a literal comparison would have missed
   * (design D2). Names only: a caller reporting this must never hold the value.
   */
  nearMissedVariables(): string[] {
    return [...this.nearMissed];
  }

  /**
   * Whether no value is registered — i.e. nothing in the run referenced
   * `{{env.*}}`. Says nothing about which values, so a caller deciding what a
   * report may carry never holds a secret to decide it.
   */
  isEmpty(): boolean {
    return this.secrets.size === 0;
  }
}
