import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { AuthConfig } from './config.js';
import type { AgentBrain } from './llm/brain.js';
import type { PageLike } from './runner/actions.js';
import { BudgetExhaustedError } from './runner/budget.js';
import { SecretsMask, substituteEnv } from './runner/env.js';
import { defaultSnapshot, executeTest, type ExecutorEvent } from './runner/executor.js';

/** Where a captured session is cached when `auth.cache` is enabled (design D9). */
export const AUTH_STATE_RELATIVE_PATH = path.join('.blastproof', '.auth-state.json');

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Playwright storage state: cookies plus per-origin storage. */
export interface StorageState {
  cookies: unknown[];
  origins: unknown[];
}

/**
 * The single internal contract every strategy produces (design D1). Consumers seed
 * a browser context with it and never learn how the session was obtained.
 */
export interface AuthSession {
  storageState?: StorageState;
  extraHTTPHeaders?: Record<string, string>;
}

/** Narrow Playwright subset the authenticator needs; real objects are compatible. */
export interface ContextLike {
  newPage(): Promise<PageLike>;
  storageState(): Promise<StorageState>;
  close(): Promise<void>;
}

export interface BrowserLike {
  newContext(options?: Record<string, unknown>): Promise<ContextLike>;
}

export interface AuthenticateOptions {
  auth: AuthConfig;
  cwd: string;
  baseUrl: string;
  browser: BrowserLike;
  brain: AgentBrain;
  maxRetries?: number;
  /** Extra origins the login journey may reach (an external identity provider). */
  allowedOrigins?: string[];
  /**
   * The run's mask. The credential typed here stays dangerous for the whole run —
   * an authenticated page can echo it during any later test — so it must be
   * registered where every prompt can see it, not in a mask discarded at login.
   */
  mask: SecretsMask;
  /** Injectable snapshotter, mirroring the executor, so tests need no browser. */
  snapshot?: (page: PageLike) => Promise<string>;
  /**
   * The configured `browser.timeout_ms` (design D1/D2, browser-patience): bounds
   * resolving a target element and navigation during the login journey, exactly as
   * for any other test. A login page is the worst place for this gap to survive —
   * a slow hydration here fails the whole run (exit 2), not one test.
   *
   * Required, not optional — same reasoning as {@link AuthenticateOptions.mask}
   * and as `budget` on `createBrain`/`createPlanner` (spec run-budget): this is
   * the second time an optional field meant to close a gap discovered at one call
   * site was silently left unset at another (`plan`'s budget, then here). Unlike
   * `budget`, there is no meaningful "unset" value for a wait — every real caller
   * already has one (`config.browser.timeout_ms`, itself always defaulted), so
   * nothing is lost by the compiler requiring it.
   */
  timeoutMs: number;
  /**
   * Caps accessibility-tree lines sent to the model during the login journey
   * (mirrors the executor's option of the same name). Only applies to the default
   * snapshotter; an injected `snapshot` fully replaces it.
   */
  maxSnapshotLines?: number;
  /**
   * Progress reporter for the login journey. Without it authentication is a black
   * box, and a failing login is the moment you most need to see what happened.
   */
  onEvent?: (event: ExecutorEvent) => void;
}

function isStorageState(value: unknown): value is StorageState {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as StorageState).cookies) &&
    Array.isArray((value as StorageState).origins)
  );
}

/** Reads a previously captured state, failing with the path when unusable. */
async function fromStorageState(file: string): Promise<AuthSession> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new AuthError(
      `Cannot read auth.storage_state at ${file}. Capture a session first, or switch to an auth.steps recipe.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuthError(`Invalid JSON in auth.storage_state at ${file}.`);
  }
  if (!isStorageState(parsed)) {
    throw new AuthError(
      `Invalid storage state at ${file}: expected an object with "cookies" and "origins" arrays.`,
    );
  }
  return { storageState: parsed };
}

/**
 * Builds a session from static values (design D2). `{{env.*}}` placeholders are
 * substituted here, so a token never has to be written into the config file.
 */
function fromStatic(auth: AuthConfig, mask: SecretsMask): AuthSession {
  const session: AuthSession = {};

  if (auth.headers) {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(auth.headers)) {
      mask.registerFrom(value);
      headers[name] = substituteEnv(value);
    }
    session.extraHTTPHeaders = headers;
  }

  if (auth.cookies) {
    const cookies = auth.cookies.map((cookie) => {
      mask.registerFrom(cookie.value);
      return { ...cookie, value: substituteEnv(cookie.value) };
    });
    session.storageState = { cookies, origins: [] };
  }

  return session;
}

/** Runs the journey, converting any thrown error into an AuthError. */
async function runJourney(
  ...args: Parameters<typeof executeTest>
): ReturnType<typeof executeTest> {
  try {
    return await executeTest(...args);
  } catch (error) {
    // A budget/deadline stop during login is still a budget stop, not a broken
    // auth recipe (design D3): the run must end as incomplete, not be reported as
    // a configuration failure. Let the caller (runCommand) handle it as such.
    if (error instanceof BudgetExhaustedError) throw error;
    throw new AuthError(
      `Authentication could not run: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Runs the login journey once in an empty context and captures the resulting
 * session (design D2/D3). Reuses the agentic executor, so a login is described in
 * exactly the same plain English as a test.
 */
async function fromSteps(options: AuthenticateOptions): Promise<AuthSession> {
  const { auth, baseUrl, browser, brain, maxRetries, snapshot, timeoutMs, maxSnapshotLines, onEvent, mask } =
    options;
  const steps = auth.steps!;
  // Same wiring as the executor (browser-patience design D1/D2): defaulting
  // `snapshot` straight to `defaultSnapshot` — as this used to — bypasses
  // `maxSnapshotLines` entirely, since an already-defined `snapshot` short-circuits
  // executeTest's own cap-aware default. Building the fallback here instead means
  // the cap actually reaches the page render; an injected `snapshot` (tests) still
  // fully replaces it, same contract as the executor.
  const takeSnapshot = snapshot ?? ((page: PageLike) => defaultSnapshot(page, maxSnapshotLines));

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // The executor's opening navigation happens outside its per-step error handling,
    // so an unreachable app throws raw here. Every failure in this function must
    // surface as an AuthError with an actionable message (design D6).
    const result = await runJourney(
      page,
      {
        path: '<auth>',
        summary: 'authentication',
        steps,
        priority: 'P0',
        tags: [],
        routes: [],
        auth: false,
      },
      {
        brain,
        sessionDir: path.join(options.cwd, '.blastproof', 'reports', 'auth'),
        baseUrl,
        allowedOrigins: options.allowedOrigins,
        resolveValue: (value) => substituteEnv(value),
        maxRetries,
        timeoutMs,
        mask: (text) => mask.mask(text),
        snapshot: takeSnapshot,
        onEvent,
      },
    );

    if (result.status === 'failed') {
      throw new AuthError(
        `Authentication failed at step "${result.failedStep ?? 'unknown'}": ${result.reason ?? 'no reason given'}`,
      );
    }

    // Optional post-login check: turns N mysterious test failures into one message (D5).
    if (auth.verify) {
      // `auth.verify` is passed as BOTH the step and the expectation here — this
      // is deliberate, not a copy-paste mistake (design judge-the-step, task 2.4).
      //
      // An earlier version built the step from the login journey's own action
      // list ("complete the login journey: navigate to /login; fill username;
      // fill password; submit"), keeping `auth.verify` as the expectation. Against
      // a real model that inverted the fix: anchored on that step, the judge went
      // looking for evidence the *actions* had happened — but a successful login
      // navigates away from /login, so the very steps ("navigate to /login, fill
      // username, ...") describe a page the judge is no longer looking at, and it
      // correctly (by its new instructions) refused to call unverifiable actions
      // verified. `auth.verify` is not a transcript of actions; it is already
      // written as the outcome to check ("a signed-in indicator is visible") —
      // exactly what the step is supposed to be everywhere else in this design.
      // There is no separate model-generated claim here the way an executor
      // `assert` has one, so there is nothing to hold apart from it: the
      // configured text is both the question and the claim offered for it.
      const judgment = await brain.judge(auth.verify, auth.verify, mask.mask(await takeSnapshot(page)));
      if (!judgment.pass) {
        throw new AuthError(`Authentication could not be verified: ${mask.mask(judgment.reason)}`);
      }
    }

    return { storageState: await context.storageState() };
  } finally {
    await context.close();
  }
}

/** Reads the cached session, or undefined when absent or unusable. */
async function readCached(cwd: string): Promise<AuthSession | undefined> {
  try {
    return await fromStorageState(path.join(cwd, AUTH_STATE_RELATIVE_PATH));
  } catch {
    return undefined;
  }
}

/** Persists the captured session. Never logged: it is a live credential (design D7). */
async function writeCached(cwd: string, session: AuthSession): Promise<void> {
  if (!session.storageState) return;
  const file = path.join(cwd, AUTH_STATE_RELATIVE_PATH);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(session.storageState), 'utf8');
}

/**
 * Produces the authenticated session for a run, at most once (design D3).
 * Throws {@link AuthError} with an actionable message; callers abort before
 * executing any test, since a failed login is a configuration problem and must
 * not be reported as failing tests (design D6).
 */
export async function authenticate(options: AuthenticateOptions): Promise<AuthSession> {
  const { auth, cwd } = options;

  if (auth.cache) {
    const cached = await readCached(cwd);
    if (cached) return cached;
  }

  if (auth.storage_state) {
    return fromStorageState(path.resolve(cwd, auth.storage_state));
  }

  if (auth.headers || auth.cookies) {
    return fromStatic(auth, options.mask);
  }

  const session = await fromSteps(options);
  if (auth.cache) await writeCached(cwd, session);
  return session;
}

/** Context options that seed a browser context with the session, if any. */
export function contextOptions(session: AuthSession | undefined): Record<string, unknown> {
  if (!session) return {};
  return {
    ...(session.storageState ? { storageState: session.storageState } : {}),
    ...(session.extraHTTPHeaders ? { extraHTTPHeaders: session.extraHTTPHeaders } : {}),
  };
}
