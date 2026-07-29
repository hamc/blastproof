import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authenticate,
  AuthError,
  AUTH_STATE_RELATIVE_PATH,
  contextOptions,
  type BrowserLike,
  type StorageState,
} from '../src/auth.js';
import type { AuthConfig } from '../src/config.js';
import type { AgentBrain } from '../src/llm/brain.js';
import { BudgetExhaustedError } from '../src/runner/budget.js';
import { SecretsMask } from '../src/runner/env.js';

const CAPTURED: StorageState = { cookies: [{ name: 'session', value: 'abc' }], origins: [] };

/** Browser double: one context whose page records navigation and actions. */
function fakeBrowser(overrides: { fail?: boolean } = {}): {
  browser: BrowserLike;
  contexts: Record<string, unknown>[];
} {
  const contexts: Record<string, unknown>[] = [];
  const browser: BrowserLike = {
    async newContext(options = {}) {
      contexts.push(options);
      return {
        async newPage() {
          return {
            goto: async () => undefined,
            url: () => 'http://localhost/account',
            getByRole: () => ({}) as never,
            getByLabel: () => ({}) as never,
            getByText: () => ({}) as never,
            keyboard: { press: async () => {} },
            screenshot: async () => undefined,
          } as never;
        },
        async storageState() {
          if (overrides.fail) throw new Error('no state');
          return CAPTURED;
        },
        async close() {},
      };
    },
  };
  return { browser, contexts };
}

/** Brain that drives the login journey to completion, or fails it. */
function stubBrain(opts: { succeed?: boolean; verifyPasses?: boolean } = {}): AgentBrain {
  const { succeed = true, verifyPasses = true } = opts;
  return {
    async nextAction() {
      return succeed
        ? { action: 'done' as const, reasoning: 'signed in' }
        : { action: 'fail' as const, reasoning: 'credentials rejected' };
    },
    async judge() {
      return { pass: verifyPasses, reason: verifyPasses ? 'indicator visible' : 'still on login' };
    },
  };
}

/**
 * Brain whose first turn is an assert that judges pass, and whose second turn —
 * reachable only if the executor still `continue`s past a passing assertion —
 * fails the step. Used to prove `authenticate()` inherits the fix (task 3.1).
 */
function assertThenFailBrain(): AgentBrain {
  let calls = 0;
  return {
    async nextAction() {
      calls++;
      if (calls === 1) return { action: 'assert' as const, reasoning: 'check', expectation: 'signed in' };
      return { action: 'fail' as const, reasoning: 'should never be requested' };
    },
    async judge() {
      return { pass: true, reason: 'signed-in indicator visible' };
    },
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blastproof-auth-'));
  await mkdir(path.join(dir, '.blastproof'), { recursive: true });
  process.env.BLASTPROOF_AUTH_TOKEN = 'super-secret-token';
  process.env.BLASTPROOF_AUTH_PASSWORD = 'hunter2';
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.BLASTPROOF_AUTH_TOKEN;
  delete process.env.BLASTPROOF_AUTH_PASSWORD;
  await rm(dir, { recursive: true, force: true });
});

function options(auth: AuthConfig, brain: AgentBrain = stubBrain(), browser?: BrowserLike) {
  return {
    auth,
    cwd: dir,
    baseUrl: 'http://localhost:4173',
    browser: browser ?? fakeBrowser().browser,
    brain,
    // The run's mask: the credential typed here stays live for the whole run.
    mask: new SecretsMask(),
    snapshot: async () => '- heading "Welcome"',
  };
}

describe('authenticate: steps strategy', () => {
  it('runs the journey once and captures the session', async () => {
    const { browser, contexts } = fakeBrowser();
    const session = await authenticate(
      options({ steps: ['navigate to /login', 'sign in'], cache: false }, stubBrain(), browser),
    );

    expect(session.storageState).toEqual(CAPTURED);
    expect(contexts).toHaveLength(1);
  });

  it('raises AuthError when the journey fails', async () => {
    await expect(
      authenticate(options({ steps: ['sign in'], cache: false }, stubBrain({ succeed: false }))),
    ).rejects.toThrow(AuthError);
  });

  it('raises AuthError when verify does not hold', async () => {
    await expect(
      authenticate(
        options(
          { steps: ['sign in'], verify: 'a signed-in indicator is visible', cache: false },
          stubBrain({ verifyPasses: false }),
        ),
      ),
    ).rejects.toThrow(/could not be verified/);
  });

  it('does not abort with AuthError when the login journey ends on a passing assertion', async () => {
    // Single-step journey: if the executor still `continue`d past a passing
    // assertion, this step's second nextAction call would return `fail` and
    // authenticate() would raise AuthError, aborting the whole run before a
    // single test executes — no score, no report (blast radius per proposal).
    const session = await authenticate(
      options({ steps: ['assert a signed-in indicator is visible'], cache: false }, assertThenFailBrain()),
    );

    expect(session.storageState).toEqual(CAPTURED);
  });

  it('propagates a budget/deadline stop as itself, not as an AuthError (spec run-budget)', async () => {
    // A budget stop during login is a budget stop, not a broken auth recipe: the
    // run must end incomplete, not be reported as a configuration failure.
    const brain: AgentBrain = {
      nextAction: async () => {
        throw new BudgetExhaustedError('calls', 1, 1);
      },
      judge: async () => ({ pass: true, reason: 'n/a' }),
    };

    await expect(
      authenticate(options({ steps: ['sign in'], cache: false }, brain)),
    ).rejects.toThrow(BudgetExhaustedError);
  });

  it('keeps a substituted password out of the error message', async () => {
    const error = await authenticate(
      options(
        { steps: ['fill the password field with {{env.BLASTPROOF_AUTH_PASSWORD}}'], cache: false },
        stubBrain({ succeed: false }),
      ),
    ).catch((e: Error) => e);

    expect(error).toBeInstanceOf(AuthError);
    expect(error.message).not.toContain('hunter2');
  });
});

describe('authenticate: storage_state strategy', () => {
  it('reads a captured state without running a journey', async () => {
    const file = path.join(dir, '.blastproof', 'auth.json');
    await writeFile(file, JSON.stringify(CAPTURED));

    const session = await authenticate(options({ storage_state: file, cache: false }));

    expect(session.storageState).toEqual(CAPTURED);
  });

  it('fails with the path when the file is missing', async () => {
    await expect(
      authenticate(options({ storage_state: '.blastproof/nope.json', cache: false })),
    ).rejects.toThrow(/nope\.json/);
  });

  it('fails when the file is not a storage state', async () => {
    const file = path.join(dir, '.blastproof', 'auth.json');
    await writeFile(file, JSON.stringify({ hello: 'world' }));

    await expect(authenticate(options({ storage_state: file, cache: false }))).rejects.toThrow(
      /expected an object with "cookies" and "origins"/,
    );
  });
});

describe('authenticate: headers/cookies strategy', () => {
  it('substitutes env placeholders into headers, without a browser', async () => {
    const session = await authenticate(
      options({ headers: { Authorization: 'Bearer {{env.BLASTPROOF_AUTH_TOKEN}}' }, cache: false }),
    );

    expect(session.extraHTTPHeaders).toEqual({ Authorization: 'Bearer super-secret-token' });
    expect(session.storageState).toBeUndefined();
  });

  it('builds a storage state from cookies', async () => {
    const session = await authenticate(
      options({ cookies: [{ name: 'session', value: '{{env.BLASTPROOF_AUTH_TOKEN}}' }], cache: false }),
    );

    expect(session.storageState?.cookies).toEqual([
      { name: 'session', value: 'super-secret-token' },
    ]);
  });
});

describe('authenticate: caching', () => {
  it('re-authenticates by default even when a cached state exists', async () => {
    await writeFile(path.join(dir, AUTH_STATE_RELATIVE_PATH), JSON.stringify(CAPTURED));
    const { browser, contexts } = fakeBrowser();

    await authenticate(options({ steps: ['sign in'], cache: false }, stubBrain(), browser));

    expect(contexts).toHaveLength(1); // a login actually happened
  });

  it('reuses the cached state when caching is enabled', async () => {
    await writeFile(path.join(dir, AUTH_STATE_RELATIVE_PATH), JSON.stringify(CAPTURED));
    const { browser, contexts } = fakeBrowser();

    const session = await authenticate(
      options({ steps: ['sign in'], cache: true }, stubBrain(), browser),
    );

    expect(session.storageState).toEqual(CAPTURED);
    expect(contexts).toHaveLength(0); // no login journey ran
  });

  it('writes the captured state when caching is enabled', async () => {
    await authenticate(options({ steps: ['sign in'], cache: true }));

    const written = await readFile(path.join(dir, AUTH_STATE_RELATIVE_PATH), 'utf8');
    expect(JSON.parse(written)).toEqual(CAPTURED);
  });
});

describe('contextOptions', () => {
  it('is empty without a session', () => {
    expect(contextOptions(undefined)).toEqual({});
  });

  it('carries only the fields the session has', () => {
    expect(contextOptions({ storageState: CAPTURED })).toEqual({ storageState: CAPTURED });
    expect(contextOptions({ extraHTTPHeaders: { A: 'b' } })).toEqual({
      extraHTTPHeaders: { A: 'b' },
    });
  });
});
