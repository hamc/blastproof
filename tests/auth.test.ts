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
import type { LocatorLike, PageLike } from '../src/runner/actions.js';
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
            // Port included, as a real page URL always is: the executor now
            // compares this against the boundary before every snapshot, and
            // `http://localhost` is a different origin from `http://localhost:4173`.
            url: () => 'http://localhost:4173/account',
            waitForLoadState: async () => {},
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

/**
 * A page whose one named element resolves only if the requested `waitFor` timeout
 * meets or exceeds `thresholdMs` — a logical stand-in for a real wait, used to
 * prove the configured `browser.timeout_ms` actually reaches the login journey's
 * element resolution (browser-patience), not just that `authenticate()` accepts
 * the option. Mirrors the fakes in `executor.test.ts`.
 */
function delayedElementPage(delayedKey: string, thresholdMs: number): { page: PageLike; calls: string[] } {
  const calls: string[] = [];
  let currentUrl = 'about:blank';

  const locatorFor = (kind: string, query: string): LocatorLike => {
    const key = `${kind}:${query}`;
    const locator: LocatorLike = {
      first: () => locator,
      async waitFor(options?: { timeout?: number }) {
        if (key !== delayedKey || (options?.timeout ?? 0) < thresholdMs) {
          throw new Error(`not visible: ${key}`);
        }
      },
      async click() {
        calls.push(`click ${key}`);
      },
      async fill(value: string) {
        calls.push(`fill ${key}=${value}`);
      },
      async press(k: string) {
        calls.push(`press ${k} on ${key}`);
      },
      async selectOption(option: { label: string }) {
        calls.push(`select ${key}=${option.label}`);
        return [option.label];
      },
    };
    return locator;
  };

  const page: PageLike = {
    async goto(url: string) {
      calls.push(`goto ${url}`);
      currentUrl = url;
      return undefined;
    },
    getByRole: (role: string, opts?: { name?: string }) => locatorFor('role', `${role}|${opts?.name ?? ''}`),
    getByLabel: (text: string) => locatorFor('label', text),
    getByText: (text: string) => locatorFor('text', text),
    keyboard: {
      press: async (k: string) => {
        calls.push(`keyboard ${k}`);
      },
    },
    screenshot: async () => undefined,
    url: () => currentUrl,
    waitForLoadState: async () => {},
  };

  return { page, calls };
}

/**
 * A page whose accessibility tree is `rawYaml`, reachable only through the real
 * `defaultSnapshot`/`captureSnapshot` path (`page.locator('body').ariaSnapshot()`)
 * — used to prove `maxSnapshotLines` actually reaches the login journey's own
 * snapshot and the `auth.verify` judge call (DEF-003), not just that
 * `AuthenticateOptions` accepts the field. `fakeBrowser`'s page (and every other
 * fake in this file) always injects an explicit `snapshot` override, which
 * bypasses the default snapshotter entirely — exactly the gap that let the cap
 * silently do nothing here in the first place.
 */
function fakeSnapshotPage(rawYaml: string): PageLike {
  return {
    async goto() {
      return undefined;
    },
    getByRole: () => ({}) as never,
    getByLabel: () => ({}) as never,
    getByText: () => ({}) as never,
    keyboard: { press: async () => {} },
    screenshot: async () => undefined,
    url: () => 'http://localhost:4173/login',
    waitForLoadState: async () => {},
    // Not part of `PageLike`; only `defaultSnapshot`'s cast to a real `Page` uses it.
    locator: () => ({ ariaSnapshot: async () => rawYaml }),
  } as unknown as PageLike;
}

/** Wraps a single already-built page in the minimal browser double `authenticate` needs. */
function fakeBrowserWithPage(page: PageLike): BrowserLike {
  return {
    async newContext() {
      return {
        async newPage() {
          return page;
        },
        async storageState() {
          return CAPTURED;
        },
        async close() {},
      };
    },
  };
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

/** Clicks the named target once, then completes the step. */
function clickThenDoneBrain(name: string): AgentBrain {
  let calls = 0;
  return {
    async nextAction() {
      calls++;
      if (calls === 1) return { action: 'click' as const, target: { role: 'button', name }, reasoning: 'click' };
      return { action: 'done' as const, reasoning: 'signed in' };
    },
    async judge() {
      return { pass: true, reason: 'n/a' };
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
    // `timeoutMs` is required on `AuthenticateOptions` (browser-patience): centralising
    // the default here, rather than at each of the ~15 call sites below, is exactly
    // what keeps that requirement cheap. Tests that care about a specific value
    // override it by spreading `...options(...)` and setting `timeoutMs` after.
    timeoutMs: 30_000,
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

  // design judge-the-step, task 2.4: `auth.verify` is already written as an
  // outcome ("a signed-in indicator is visible"), so it is passed as BOTH the
  // step and the expectation — not paired with a manufactured transcript of
  // the login steps. An earlier version built the step from the joined
  // action list ("complete the login journey: navigate to /login; fill
  // username; ..."); against a real model that inverted the fix: anchored on
  // a step describing *actions on the login page*, the judge correctly
  // refused to call them verified once a successful login had navigated away
  // from that page. `auth.verify` never describes actions, so there is
  // nothing to hold apart from it here the way an executor `assert` holds its
  // step apart from the model's own expectation.
  it('passes auth.verify as both the step and the expectation (task 2.4)', async () => {
    let seenStep = '';
    let seenExpectation = '';
    const brain: AgentBrain = {
      async nextAction() {
        return { action: 'done' as const, reasoning: 'signed in' };
      },
      async judge(step: string, expectation: string) {
        seenStep = step;
        seenExpectation = expectation;
        return { pass: true, reason: 'signed in' };
      },
    };

    await authenticate(
      options(
        { steps: ['navigate to /login', 'fill username', 'submit'], verify: 'a signed-in indicator is visible', cache: false },
        brain,
      ),
    );

    expect(seenStep).toBe('a signed-in indicator is visible');
    expect(seenExpectation).toBe('a signed-in indicator is visible');
  });

  // Regression for the defect above, confirmed against a real model: a judge
  // fake that decides from the STEP (as anchoring is supposed to make
  // possible) rather than the expectation, evaluated against a snapshot that
  // has already navigated away from the login page — exactly what a
  // successful login produces. The old transcript-shaped step named actions
  // on a page the judge is no longer looking at ("navigate to /login, fill
  // username, ...") and a step-anchored judge correctly failed it; the fixed
  // step (`auth.verify` itself) describes the outcome that snapshot actually
  // shows, so a step-anchored judge must pass it. This test is the one that
  // would have caught the regression: the earlier `auth.test.ts` only ever
  // exercised a judge deciding from the expectation, which stayed green while
  // the real model failed.
  it('a step-anchored judge still passes a successful login, on a post-login snapshot that no longer shows the login page', async () => {
    const postLoginSnapshot = '- main:\n  - heading "Good afternoon, evaluser"\n  - list "Projects":\n    - listitem: Inbox';
    const page = fakeSnapshotPage(postLoginSnapshot);
    const browser = fakeBrowserWithPage(page);
    const brain: AgentBrain = {
      async nextAction() {
        return { action: 'done' as const, reasoning: 'signed in' };
      },
      // Decides from the STEP, not the expectation — the anchoring the fix
      // enables. If `step` names actions on the login page (the regression:
      // a transcript-shaped step), it fails regardless of what the snapshot
      // shows, exactly like the real model did — a post-login snapshot has
      // navigated away from /login, so "navigate to /login, fill username,
      // submit" cannot be evidenced there even though the outcome holds. Only
      // once the step IS the outcome (the fix) can this judge pass it.
      async judge(step: string, _expectation: string, snapshot: string) {
        const describesActionsOnLoginPage = /navigate to \/login|fill username|submit/.test(step);
        if (describesActionsOnLoginPage) {
          return { pass: false, reason: `step names login-page actions not evidenced in: ${snapshot}` };
        }
        const outcomeShown = snapshot.includes('Good afternoon');
        return { pass: outcomeShown, reason: outcomeShown ? 'signed-in heading visible' : 'no signed-in evidence' };
      },
    };

    const session = await authenticate({
      ...options(
        { steps: ['navigate to /login', 'fill username', 'submit'], verify: 'a signed-in indicator is visible', cache: false },
        brain,
        browser,
      ),
      snapshot: undefined, // exercise the real default snapshotter against postLoginSnapshot
    });

    expect(session.storageState).toEqual(CAPTURED);
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
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as Error).message).not.toContain('hunter2');
  });

  // Regression for the defect: `runJourney`'s call at auth.ts passed `brain`,
  // `sessionDir`, `baseUrl`, `allowedOrigins`, `resolveValue`, `maxRetries`, `mask`,
  // `snapshot` and `onEvent` — never `timeoutMs` — so a login page's own slow
  // element was bound by the old fixed 2s regardless of `browser.timeout_ms`. This
  // is the worst place for the gap to survive: a failed login aborts the whole run
  // with exit 2, not one test.
  it('resolves a login element visible only after the old fixed 2s once given the configured timeout, without needing a retry', async () => {
    const { page } = delayedElementPage('role:button|Sign in', 4_000);
    const browser = fakeBrowserWithPage(page);
    const brain = clickThenDoneBrain('Sign in');

    const session = await authenticate({
      ...options({ steps: ['click sign in'], cache: false }, brain, browser),
      // maxRetries: 1 means a single failed resolution attempt would already abort
      // the whole login — so succeeding here proves the element resolved on the
      // first attempt, not merely "eventually, within some retry budget".
      maxRetries: 1,
      timeoutMs: 10_000,
    });

    expect(session.storageState).toEqual(CAPTURED);
  });

  it('fails the same login element when the configured timeout does not cover its wait', async () => {
    const { page } = delayedElementPage('role:button|Sign in', 4_000);
    const browser = fakeBrowserWithPage(page);
    const brain = clickThenDoneBrain('Sign in');

    await expect(
      authenticate({
        ...options({ steps: ['click sign in'], cache: false }, brain, browser),
        maxRetries: 1,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(AuthError);
  });

  // DEF-003: `fromSteps` used to default its own `snapshot` variable straight to
  // `defaultSnapshot`, so an already-defined value reached `executeTest` — which
  // meant its own `snapshot ?? defaultSnapshot(page, maxSnapshotLines)` fallback
  // never ran, and the cap silently never reached the page render. A test
  // asserting only that `AuthenticateOptions` accepts `maxSnapshotLines` would
  // pass against that bypass; these exercise the real default snapshotter.
  it('caps the login journey\'s own snapshot at the configured max_snapshot_lines (DEF-003)', async () => {
    const rawYaml = Array.from({ length: 50 }, (_, i) => `- text "line ${i}"`).join('\n');
    const page = fakeSnapshotPage(rawYaml);
    const browser = fakeBrowserWithPage(page);
    let seenSnapshot = '';
    const brain: AgentBrain = {
      async nextAction(input) {
        seenSnapshot = input.snapshot;
        return { action: 'done', reasoning: 'ok' };
      },
      async judge() {
        return { pass: true, reason: 'n/a' };
      },
    };

    await authenticate({
      ...options({ steps: ['check something'], cache: false }, brain, browser),
      snapshot: undefined, // let the real default snapshotter run, not the helper's stub
      maxSnapshotLines: 10,
    });

    expect(seenSnapshot).toContain('truncated after 10 lines');
  });

  it('caps the snapshot passed to auth.verify\'s judge call too (DEF-003)', async () => {
    const rawYaml = Array.from({ length: 50 }, (_, i) => `- text "line ${i}"`).join('\n');
    const page = fakeSnapshotPage(rawYaml);
    const browser = fakeBrowserWithPage(page);
    let judgeSnapshot = '';
    const brain: AgentBrain = {
      async nextAction() {
        return { action: 'done', reasoning: 'ok' };
      },
      async judge(_step, _expectation, snapshot) {
        judgeSnapshot = snapshot;
        return { pass: true, reason: 'ok' };
      },
    };

    await authenticate({
      ...options(
        { steps: ['check something'], verify: 'a signed-in indicator is visible', cache: false },
        brain,
        browser,
      ),
      snapshot: undefined,
      maxSnapshotLines: 10,
    });

    expect(judgeSnapshot).toContain('truncated after 10 lines');
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
