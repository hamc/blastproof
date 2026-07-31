import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentBrain } from '../src/llm/brain.js';
import type { AgentIterationInput } from '../src/llm/prompts.js';
import type { AgentAction, AssertJudgment } from '../src/llm/schemas.js';
import {
  allowedOriginsFor,
  isOriginAllowed,
  performAction,
  resolveTarget,
  type LocatorLike,
  type PageLike,
} from '../src/runner/actions.js';
import { BudgetExhaustedError } from '../src/runner/budget.js';
import { executeTest, SETTLE_TIMEOUT_MS, type ExecutorEvent, type ExecutorOptions } from '../src/runner/executor.js';
import { describeAction, StepRecovery } from '../src/runner/recovery.js';
import { captureSnapshot, trimSnapshot } from '../src/runner/snapshot.js';
import type { TestFile } from '../src/runner/testfile.js';

// --- fakes -----------------------------------------------------------------

class FakeLocator implements LocatorLike {
  constructor(
    private readonly page: FakePage,
    readonly kind: string,
    readonly query: string,
  ) {}

  first(): LocatorLike {
    return this;
  }

  private resolve(): void {
    const key = `${this.kind}:${this.query}`;
    // A key registered in `delayedVisible` is treated as visible for click/fill/etc:
    // by the time one of those runs, `waitFor` (below) has already blocked until it
    // appeared — this only matters for the browser-patience regression tests, which
    // always resolve through `waitFor` first.
    if (!this.page.visible.has(key) && !this.page.delayedVisible.has(key)) {
      throw new Error(`not visible: ${key}`);
    }
  }

  /**
   * `waitFor` alone honours a delayed appearance (browser-patience regression
   * tests, design D1/D2/D3): a key registered in `page.delayedVisible` only
   * resolves once the requested `timeout` is at least its threshold, simulating
   * an element that becomes visible after some real wait. This is a logical
   * stand-in for elapsed time — it asserts that the configured timeout value
   * actually reaches Playwright's wait, not that timing itself is accurate
   * (Playwright's own concern, not this codebase's).
   */
  async waitFor(options?: { timeout?: number }): Promise<void> {
    const key = `${this.kind}:${this.query}`;
    if (this.page.visible.has(key)) return;
    const threshold = this.page.delayedVisible.get(key);
    if (threshold !== undefined) {
      if ((options?.timeout ?? 0) >= threshold) return;
      throw new Error(`not visible within ${options?.timeout ?? 0}ms (appears after ${threshold}ms): ${key}`);
    }
    throw new Error(`not visible: ${key}`);
  }

  async click(): Promise<void> {
    this.resolve();
    this.page.calls.push(`click ${this.kind}:${this.query}`);
  }

  async fill(value: string): Promise<void> {
    this.resolve();
    this.page.calls.push(`fill ${this.kind}:${this.query}=${value}`);
  }

  async press(key: string): Promise<void> {
    this.resolve();
    this.page.calls.push(`press ${key} on ${this.kind}:${this.query}`);
  }

  async selectOption(option: { label: string }): Promise<string[]> {
    this.resolve();
    this.page.calls.push(`select ${this.kind}:${this.query}=${option.label}`);
    return [option.label];
  }
}

class FakePage implements PageLike {
  calls: string[] = [];
  visible = new Set<string>();
  /** key ("role:button|Checkout") → ms the requested `waitFor` timeout must meet
   *  or exceed to resolve (browser-patience regression tests). */
  delayedVisible = new Map<string, number>();
  screenshots: string[] = [];
  currentUrl = 'about:blank';
  /** Every `timeout` passed to `goto`, in call order (browser-patience task 2.4). */
  gotoTimeouts: (number | undefined)[] = [];
  /**
   * Simulated ms this page would need to reach network idle
   * (trustworthy-verdicts design D1, tasks 5.1/5.2/5.5). Threshold-based, like
   * `delayedVisible` above: `waitForLoadState` resolves immediately once the
   * requested `timeout` is at least this value, and rejects immediately —
   * mirroring Playwright's own timeout error, not a real wait — when it is
   * not. `undefined` (default) settles immediately regardless of the
   * requested timeout, so it doesn't disturb any test that doesn't care.
   */
  settleThresholdMs: number | undefined = undefined;
  /** Every `waitForLoadState` call's requested timeout, in call order (task 5.2). */
  settleTimeouts: (number | undefined)[] = [];
  /** Raw aria snapshot returned by `locator('body').ariaSnapshot()`, for exercising
   *  the real `defaultSnapshot`/`captureSnapshot` cap-threading path (task 3.2/3.3). */
  snapshotYaml = '';

  keyboard = {
    press: async (key: string) => {
      this.calls.push(`keyboard ${key}`);
    },
  };

  async goto(url: string, options?: { timeout?: number }): Promise<void> {
    this.calls.push(`goto ${url}`);
    this.currentUrl = url;
    this.gotoTimeouts.push(options?.timeout);
  }

  getByRole(role: string, options?: { name?: string }): LocatorLike {
    return new FakeLocator(this, 'role', `${role}|${options?.name ?? ''}`);
  }

  getByLabel(text: string): LocatorLike {
    return new FakeLocator(this, 'label', text);
  }

  getByText(text: string): LocatorLike {
    return new FakeLocator(this, 'text', text);
  }

  async screenshot(options: { path: string }): Promise<void> {
    this.screenshots.push(options.path);
  }

  url(): string {
    return this.currentUrl;
  }

  async waitForLoadState(_state: 'networkidle', options?: { timeout?: number }): Promise<void> {
    this.calls.push('waitForLoadState');
    this.settleTimeouts.push(options?.timeout);
    if (this.settleThresholdMs !== undefined && (options?.timeout ?? 0) < this.settleThresholdMs) {
      throw new Error(`waitForLoadState: Timeout ${options?.timeout ?? 0}ms exceeded.`);
    }
  }

  /** Not part of `PageLike`; only `defaultSnapshot`'s cast to a real `Page` uses it. */
  locator(_selector: string): { ariaSnapshot(): Promise<string> } {
    return { ariaSnapshot: async () => this.snapshotYaml };
  }
}

function scriptedBrain(script: Array<AgentAction | Error>, judgments?: AssertJudgment[]): AgentBrain & {
  calls: number;
  judgeCalls: number;
} {
  let calls = 0;
  let judgmentCalls = 0;
  return {
    get calls() {
      return calls;
    },
    // Exposed so a test can pin how many judgments a step spent: re-observation
    // (design D3) makes a failed assertion cost two, and DEF-004 was filed
    // because widening a scripted judgment list hid that rather than asserting it.
    get judgeCalls() {
      return judgmentCalls;
    },
    async nextAction(): Promise<AgentAction> {
      const next = script[calls++];
      if (!next) throw new Error('script exhausted');
      if (next instanceof Error) throw next;
      return next;
    },
    async judge(): Promise<AssertJudgment> {
      const next = judgments?.[judgmentCalls++];
      if (!next) throw new Error('judgment script exhausted');
      return next;
    },
  };
}

const click = (name: string, reasoning = 'r'): AgentAction => ({
  action: 'click',
  target: { role: 'button', name },
  reasoning,
});

function makeTest(overrides: Partial<TestFile> = {}): TestFile {
  return {
    path: '.blastproof/tests/sample.yaml',
    summary: 'Sample test',
    steps: ['step one'],
    priority: 'P1',
    tags: [],
    ...overrides,
  };
}

let sessionDir: string;

beforeEach(async () => {
  sessionDir = await mkdtemp(path.join(tmpdir(), 'blastproof-session-'));
});

afterEach(async () => {
  await rm(sessionDir, { recursive: true, force: true });
});

/** Mirrors config `browser.timeout_ms`'s own schema default (src/config.ts). */
const DEFAULT_TEST_TIMEOUT_MS = 30_000;

/**
 * Base `ExecutorOptions` for tests that don't care about the specific timeout
 * value. `timeoutMs` is required on the real type (browser-patience design:
 * there is no legitimate production reason to run without it — an unset value
 * would silently reinstate the two-second wait this change exists to fix), so
 * every call site in this file must supply one. Centralising the default here,
 * rather than at each of this file's ~30 `executeTest` calls, is what keeps that
 * requirement cheap instead of scattering an arbitrary placeholder number
 * everywhere (mirrors `auth.test.ts`'s `options()`).
 */
function baseOptions(brain: AgentBrain, overrides: Partial<ExecutorOptions> = {}): ExecutorOptions {
  return {
    brain,
    sessionDir,
    baseUrl: 'http://x.test',
    timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
    snapshot: async () => 'snap',
    ...overrides,
  };
}

// --- executor loop ----------------------------------------------------------

describe('executeTest', () => {
  it('passes a test when the LLM completes each step with done', async () => {
    const page = new FakePage();
    page.visible.add('role:button|Add to cart');
    const brain = scriptedBrain([click('Add to cart'), { action: 'done', reasoning: 'item added' }]);

    const result = await executeTest(page, makeTest(), baseOptions(brain, { baseUrl: 'http://localhost:4173' }));

    expect(result.status).toBe('passed');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe('passed');
    expect(page.calls[0]).toBe('goto http://localhost:4173/');
    expect(page.screenshots).toHaveLength(0);
  });

  it('runs setup steps before test steps', async () => {
    const page = new FakePage();
    const brain = scriptedBrain([{ action: 'done', reasoning: 's' }, { action: 'done', reasoning: 'm' }]);
    const events: ExecutorEvent[] = [];

    const result = await executeTest(
      page,
      makeTest({ setup: ['log in first'], steps: ['main step'] }),
      baseOptions(brain, { snapshot: async () => 's', onEvent: (e) => events.push(e) }),
    );

    expect(result.status).toBe('passed');
    expect(result.steps.map((s) => [s.step, s.setup])).toEqual([
      ['log in first', true],
      ['main step', false],
    ]);
  });

  it('self-heals: retries with a fresh snapshot after an element is not found', async () => {
    const page = new FakePage();
    // First click targets a stale label, second attempt picks the right one.
    const brain = scriptedBrain([
      click('Old label'),
      click('New label'),
      { action: 'done', reasoning: 'clicked' },
    ]);
    page.visible.add('role:button|New label');

    const result = await executeTest(page, makeTest(), baseOptions(brain, { snapshot: async () => 'fresh snap' }));

    expect(result.status).toBe('passed');
    expect(result.steps[0]?.failedAttempts).toBe(1);
    expect(brain.calls).toBe(3);
  });

  it('fails the step when the LLM returns fail, captures a screenshot, stops remaining steps', async () => {
    const page = new FakePage();
    const brain = scriptedBrain([{ action: 'fail', reasoning: 'login button is gone' }]);

    const result = await executeTest(page, makeTest({ steps: ['do a', 'do b'] }), baseOptions(brain));

    expect(result.status).toBe('failed');
    expect(result.steps).toHaveLength(1);
    expect(result.failedStep).toBe('do a');
    expect(result.reason).toContain('login button is gone');
    expect(result.screenshot).toBeDefined();
    expect(page.screenshots[0]).toContain('sample-test');
    expect(page.screenshots[0]).toMatch(/\.png$/);
  });

  it('exhausts the retry budget on repeated element failures and fails the step', async () => {
    const page = new FakePage(); // nothing visible
    const brain = scriptedBrain([click('Nope'), click('Nope'), click('Nope')]);

    const result = await executeTest(page, makeTest(), baseOptions(brain, { maxRetries: 3 }));

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('Element not found');
    expect(result.steps[0]?.failedAttempts).toBe(3);
  });

  it('counts malformed model output as a failed attempt', async () => {
    const page = new FakePage();
    const brain = scriptedBrain([
      new Error('Model returned an invalid action'),
      { action: 'done', reasoning: 'recovered' },
    ]);

    const result = await executeTest(page, makeTest(), baseOptions(brain));

    expect(result.status).toBe('passed');
    expect(result.steps[0]?.failedAttempts).toBe(1);
  });

  it('terminates the step on a passing assertion: an offered fail is never requested', async () => {
    const page = new FakePage();
    // The second scripted action would fail the step if it were ever asked for.
    // Regression for the defect: a passing assertion used to `continue` the loop,
    // giving the model a further turn in which it could contradict its own pass.
    const brain = scriptedBrain(
      [
        { action: 'assert', reasoning: 'check', expectation: 'total is $80' },
        { action: 'fail', reasoning: 'should never be requested' },
      ],
      [{ pass: true, reason: 'total shows $80' }],
    );

    const result = await executeTest(page, makeTest(), baseOptions(brain));

    expect(result.status).toBe('passed');
    expect(result.steps[0]?.status).toBe('passed');
  });

  it('makes no further nextAction call once an assertion passes (design D3: the economic claim)', async () => {
    const page = new FakePage();
    const brain = scriptedBrain(
      [{ action: 'assert', reasoning: 'check', expectation: 'total is $80' }],
      [{ pass: true, reason: 'total shows $80' }],
    );

    const result = await executeTest(page, makeTest(), baseOptions(brain));

    expect(result.status).toBe('passed');
    expect(brain.calls).toBe(1);
  });

  it('retries a failing assertion to the budget and then fails the step, unchanged', async () => {
    const page = new FakePage();
    const failing = scriptedBrain(
      Array(3).fill({ action: 'assert', reasoning: 'check', expectation: 'total is $80' }),
      // Six, not three: each failed judgment is now re-judged against a freshly
      // settled page before control returns to the model (design D3), so three
      // failing attempts consume two judgments apiece.
      Array(6).fill({ pass: false, reason: 'no total rendered' }),
    );

    const failResult = await executeTest(page, makeTest(), baseOptions(failing, { maxRetries: 3 }));

    expect(failResult.status).toBe('failed');
    expect(failResult.reason).toContain('no total rendered');
    expect(failResult.steps[0]?.failedAttempts).toBe(3);
    // Widening the scripted judgments from 3 to 6 was not bookkeeping: each
    // failed judgment is re-judged against a freshly settled page before the
    // model is asked again (design D3). Assert that, or this test would keep
    // passing if re-observation were reverted (DEF-004).
    expect(failing.judgeCalls).toBe(6);
    expect(failing.calls).toBe(3);
  });

  it('aborts a step that exceeds the iteration cap', async () => {
    const page = new FakePage();
    const brain = scriptedBrain(Array(6).fill({ action: 'press', value: 'Tab', reasoning: 'wander' }));

    const result = await executeTest(page, makeTest(), baseOptions(brain, { maxIterationsPerStep: 5 }));

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('exceeded 5 actions');
  });

  it('masks secrets in emitted events and failure reasons', async () => {
    const page = new FakePage();
    const brain = scriptedBrain([
      { action: 'fill', target: { role: 'textbox', name: 'Password' }, value: 's3cret', reasoning: 'type s3cret' },
      { action: 'fail', reasoning: 'login with s3cret rejected' },
    ]);
    page.visible.add('role:textbox|Password');
    const events: ExecutorEvent[] = [];
    const mask = (s: string) => s.replaceAll('s3cret', '***');

    const result = await executeTest(page, makeTest(), baseOptions(brain, { mask, onEvent: (e) => events.push(e) }));

    const serialized = JSON.stringify(events) + JSON.stringify(result);
    expect(serialized).not.toContain('s3cret');
    expect(serialized).toContain('***');
    // …but the real value reached the page
    expect(page.calls).toContain('fill role:textbox|Password=s3cret');
  });

  // Spec agentic-execution, scenario "Budget exhausted mid-step" (design D3): a
  // budget/deadline stop ends the run, it does not fail the step or the test.
  describe('budget exhaustion (design D3)', () => {
    it('propagates BudgetExhaustedError from nextAction instead of failing the step', async () => {
      const page = new FakePage();
      const brain = scriptedBrain([new BudgetExhaustedError('calls', 5, 5)]);

      await expect(executeTest(page, makeTest(), baseOptions(brain))).rejects.toThrow(BudgetExhaustedError);
    });

    it('propagates BudgetExhaustedError from judge instead of failing the step', async () => {
      const page = new FakePage();
      const brain: AgentBrain = {
        nextAction: async () => ({ action: 'assert', reasoning: 'check', expectation: 'total is $80' }),
        judge: async () => {
          throw new BudgetExhaustedError('tokens', 1000, 1000);
        },
      };

      await expect(executeTest(page, makeTest(), baseOptions(brain))).rejects.toThrow(BudgetExhaustedError);
    });

    it('does not spend it from the retry budget: a single exhaustion is never retried', async () => {
      const page = new FakePage();
      let calls = 0;
      const brain: AgentBrain = {
        nextAction: async () => {
          calls++;
          throw new BudgetExhaustedError('calls', 1, 1);
        },
        judge: async () => ({ pass: true, reason: 'n/a' }),
      };

      await expect(executeTest(page, makeTest(), baseOptions(brain, { maxRetries: 3 }))).rejects.toThrow(
        BudgetExhaustedError,
      );
      expect(calls).toBe(1);
    });
  });
});

// --- action mapping ---------------------------------------------------------

describe('performAction / resolveTarget', () => {
  it('resolves relative navigate URLs against base_url', async () => {
    const page = new FakePage();
    const result = await performAction(
      page,
      { action: 'navigate', value: '/login', reasoning: 'go' },
      { baseUrl: 'http://localhost:4173' },
    );
    expect(page.calls).toContain('goto http://localhost:4173/login');
    expect(result).toContain('/login');
  });

  it('falls back to getByLabel then getByText when role resolution misses', async () => {
    const page = new FakePage();
    page.visible.add('text:Save changes');
    const locator = await resolveTarget(page, { role: 'button', name: 'Save changes' });
    await locator.click();
    expect(page.calls).toContain('click text:Save changes');
  });

  it('throws ActionError naming the target when nothing resolves', async () => {
    const page = new FakePage();
    await expect(resolveTarget(page, { role: 'button', name: 'Ghost' })).rejects.toThrow(
      /Element not found: role=button name="Ghost"/,
    );
  });

  it('requires a value for fill and a target for click', async () => {
    const page = new FakePage();
    await expect(
      performAction(page, { action: 'fill', target: { role: 'textbox', name: 'x' }, reasoning: 'r' }, { baseUrl: 'http://x.test' }),
    ).rejects.toThrow(/requires a value/);
    await expect(
      performAction(page, { action: 'click', reasoning: 'r' }, { baseUrl: 'http://x.test' }),
    ).rejects.toThrow(/requires a target/);
  });

  it('rejects control actions handled by the executor', async () => {
    const page = new FakePage();
    await expect(
      performAction(page, { action: 'done', reasoning: 'r' }, { baseUrl: 'http://x.test' }),
    ).rejects.toThrow(/handled by the executor/);
  });

  it('presses a key on the page when no target is given', async () => {
    const page = new FakePage();
    await performAction(page, { action: 'press', value: 'Enter', reasoning: 'r' }, { baseUrl: 'http://x.test' });
    expect(page.calls).toContain('keyboard Enter');
  });
});

// --- browser-patience: resolution and navigation honour the configured timeout ---
// Regression tests for the defect: `ActionContext.resolveTimeoutMs` was never set by
// any caller, so `resolveTarget` always fell back to a fixed 2s and `navigate` to a
// hardcoded 30s, regardless of `browser.timeout_ms` (design D1/D2/D3).

describe('navigate honours the configured timeout, not a fixed value (task 2.4)', () => {
  it('passes the context timeout to page.goto', async () => {
    const page = new FakePage();
    await performAction(
      page,
      { action: 'navigate', value: '/checkout', reasoning: 'go' },
      { baseUrl: 'http://localhost:4173', resolveTimeoutMs: 5_000 },
    );
    expect(page.gotoTimeouts).toEqual([5_000]);
  });

  it('falls back to 30s when no timeout is configured, unchanged from before', async () => {
    const page = new FakePage();
    await performAction(
      page,
      { action: 'navigate', value: '/checkout', reasoning: 'go' },
      { baseUrl: 'http://localhost:4173' },
    );
    expect(page.gotoTimeouts).toEqual([30_000]);
  });
});

describe('executeTest threads the configured browser timeout into resolution (design D1/D2/D3)', () => {
  it('resolves an element visible only after the old fixed 2s once given a longer configured timeout, consuming no retry', async () => {
    const page = new FakePage();
    // Needs a wait of at least 4s to resolve — longer than the old hardcoded 2s
    // default that `resolveTarget` fell back to before this fix, since no caller
    // ever set `ActionContext.resolveTimeoutMs`. Before the fix, `executeTest` had
    // no `timeoutMs` option at all, so this element could never resolve regardless
    // of what a user set in `browser.timeout_ms`.
    page.delayedVisible.set('role:button|Checkout', 4_000);
    const brain = scriptedBrain([click('Checkout'), { action: 'done', reasoning: 'clicked' }]);

    const result = await executeTest(page, makeTest(), baseOptions(brain, { timeoutMs: 10_000 }));

    expect(result.status).toBe('passed');
    expect(page.calls).toContain('click role:button|Checkout');
    // Waiting is not retrying (design D3): the slow element cost nothing from the
    // self-healing retry budget.
    expect(result.steps[0]?.failedAttempts).toBe(0);
  });

  it('fails the same resolution when the configured timeout does not cover the wait (would also fail pre-fix, for the same reason)', async () => {
    const page = new FakePage();
    page.delayedVisible.set('role:button|Checkout', 4_000);
    const brain = scriptedBrain([click('Checkout'), click('Checkout'), click('Checkout')]);

    const result = await executeTest(page, makeTest(), baseOptions(brain, { timeoutMs: 1_000, maxRetries: 3 }));

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('Element not found');
  });

  it('an element that never appears still fails and never consumes more than one retry per attempt, however large the configured timeout (task 2.3)', async () => {
    const page = new FakePage(); // nothing ever becomes visible, however long resolution waits
    const brain = scriptedBrain([click('Ghost'), click('Ghost'), click('Ghost')]);

    const result = await executeTest(page, makeTest(), baseOptions(brain, { timeoutMs: 60_000, maxRetries: 3 }));

    expect(result.status).toBe('failed');
    // Exactly the retry budget, not more: raising the timeout never increases the
    // number of attempts (design D3).
    expect(result.steps[0]?.failedAttempts).toBe(3);
    expect(brain.calls).toBe(3);
  });
});

// --- trustworthy-verdicts: snapshots describe a settled page (design D1/D2/D3,
// task group 2/3/5) -----------------------------------------------------------

describe('snapshots are captured only after the page settles (task group 2)', () => {
  it('waits for the page to settle before every snapshot, in order — not merely that a wait method exists (task 5.1)', async () => {
    const page = new FakePage();
    page.visible.add('role:button|Add to cart');
    const brain = scriptedBrain([click('Add to cart'), { action: 'done', reasoning: 'done' }]);

    // The injected snapshot function logs into the same ordered call list as
    // `waitForLoadState`, so the assertion below is about interleaving, not
    // merely that both were called some number of times.
    await executeTest(
      page,
      makeTest(),
      baseOptions(brain, {
        snapshot: async () => {
          page.calls.push('snapshot');
          return 'snap';
        },
      }),
    );

    // Two iterations happened (click, then done): each snapshot must be
    // immediately preceded by a settle wait, every time, not just once.
    const settleAndSnapshotCalls = page.calls.filter((c) => c === 'waitForLoadState' || c === 'snapshot');
    expect(settleAndSnapshotCalls).toEqual(['waitForLoadState', 'snapshot', 'waitForLoadState', 'snapshot']);
  });

  it('bounds settling by its own short budget, not `browser.timeout_ms` — exceeding it is silent and the loop proceeds (task 5.2, design D1)', async () => {
    const page = new FakePage();
    page.settleThresholdMs = Infinity; // never settles, however long it is given
    const brain = scriptedBrain([{ action: 'done', reasoning: 'moved on anyway' }]);

    // timeoutMs (browser.timeout_ms) is deliberately much larger than the settle
    // budget, so a settle call bounded by timeoutMs would never time out here —
    // this is what proves the bound used is SETTLE_TIMEOUT_MS, not timeoutMs.
    const result = await executeTest(page, makeTest(), baseOptions(brain, { timeoutMs: 60_000 }));

    expect(result.status).toBe('passed'); // a page that never settles does not fail the run
    expect(page.settleTimeouts).toEqual([SETTLE_TIMEOUT_MS]);
  });
});

describe('a failed judgment re-observes before the model re-decides (task group 3)', () => {
  it('an expectation that fails on a stale snapshot and holds on a settled one passes without asking the model again — the false FAIL, in unit form (task 5.3)', async () => {
    const page = new FakePage();
    const brain = scriptedBrain(
      [{ action: 'assert', reasoning: 'check', expectation: 'ticket confirmed' }],
      [
        { pass: false, reason: 'stale: still shows the form' },
        { pass: true, reason: 'settled: confirmation shown' },
      ],
    );

    const result = await executeTest(page, makeTest(), baseOptions(brain));

    expect(result.status).toBe('passed');
    expect(result.steps[0]?.status).toBe('passed');
    // The model was asked for an action exactly once: re-observation resolved
    // the false FAIL internally, without a second `nextAction` turn.
    expect(brain.calls).toBe(1);
  });

  it('an expectation that still fails on a fresh, settled snapshot returns control to the model, unchanged (task 5.4)', async () => {
    const page = new FakePage();
    let nextActionCalls = 0;
    let judgeCalls = 0;
    const brain: AgentBrain = {
      async nextAction() {
        nextActionCalls++;
        return nextActionCalls === 1
          ? { action: 'assert', reasoning: 'check', expectation: 'ticket confirmed' }
          : { action: 'done', reasoning: 'moving on' };
      },
      async judge() {
        judgeCalls++;
        return { pass: false, reason: `attempt ${judgeCalls}` };
      },
    };

    const result = await executeTest(page, makeTest(), baseOptions(brain, { maxRetries: 3 }));

    expect(result.status).toBe('passed'); // the second nextAction call chose `done`
    // Both the primary judgment and the re-observation failed — this is the
    // signal that distinguishes "control returned to the model" from a lucky
    // re-observation: two judge calls happened before nextAction was asked again.
    expect(judgeCalls).toBe(2);
    expect(nextActionCalls).toBe(2);
  });

  it('re-observation is bounded by the existing retry budget, not a budget of its own (task 5.5)', async () => {
    const page = new FakePage();
    let nextActionCalls = 0;
    let judgeCalls = 0;
    const brain: AgentBrain = {
      async nextAction() {
        nextActionCalls++;
        return { action: 'assert', reasoning: 'check', expectation: 'ticket confirmed' };
      },
      async judge() {
        judgeCalls++;
        return { pass: false, reason: 'never settles' };
      },
    };

    const result = await executeTest(page, makeTest(), baseOptions(brain, { maxRetries: 2 }));

    expect(result.status).toBe('failed');
    // Exactly the retry budget's worth of turns handed to the model...
    expect(nextActionCalls).toBe(2);
    // ...even though each of those turns cost two judge calls (primary +
    // re-observation): re-observation never grows the retry budget itself,
    // so the step still fails at exactly maxRetries and cannot loop past it.
    expect(judgeCalls).toBe(4);
  });
});

// --- judge-the-step: the step is the question, the expectation is the claim
// offered in support (design D1); an entered value is not a committed one
// (design D2) --------------------------------------------------------------

/**
 * A judge fake that decides from the STEP's own quoted target rather than
 * from whatever the model's expectation claims — the anchoring the fix is
 * supposed to make possible. `expectation` is only echoed into the reason,
 * mirroring design D1: useful context, not the question. A match only counts
 * if it sits outside a line naming an editable, unsubmitted control (design
 * D2) — a plain heuristic stand-in for "entered is not committed".
 */
function stepAnchoredJudge(step: string, expectation: string, snapshot: string): AssertJudgment {
  const target = /"([^"]+)"/.exec(step)?.[1] ?? '';
  const committedLine = snapshot
    .split('\n')
    .find((line) => target.length > 0 && line.includes(target) && !/textbox|dialog/i.test(line));
  return committedLine
    ? { pass: true, reason: `"${target}" is committed: ${committedLine.trim()} (offered: ${expectation})` }
    : { pass: false, reason: `"${target}" is not committed outside an editable control (offered: ${expectation})` };
}

describe('judge-the-step: the step is the question (task group 2/3, #31)', () => {
  it(
    'fails the step when the offered expectation is true of the page but does not establish the step ' +
      '(task 4.1 — the "Show Archived checkbox" substitution)',
    async () => {
      const page = new FakePage();
      const step = 'verify "Eval Gamma Project" is visible in the projects list';
      // The snapshot genuinely lacks the project; it does contain something
      // else that is true — exactly the shape of the observed defect.
      const snapshot = [
        '- main:',
        '  - list "Projects":',
        '    - listitem: Inbox',
        '    - listitem: My Open Tasks',
        '  - checkbox "Show Archived"',
      ].join('\n');
      const receivedSteps: string[] = [];
      const brain: AgentBrain = {
        async nextAction() {
          // True of the snapshot, and unrelated to what the step asks —
          // the claim that closed the step in the observed defect.
          return { action: 'assert', reasoning: 'checking', expectation: 'the Show Archived checkbox is visible' };
        },
        async judge(receivedStep, expectation, snap) {
          receivedSteps.push(receivedStep);
          return stepAnchoredJudge(receivedStep, expectation, snap);
        },
      };

      const result = await executeTest(
        page,
        makeTest({ steps: [step] }),
        baseOptions(brain, { snapshot: async () => snapshot, maxRetries: 1 }),
      );

      // Fails against current code (task 4.6): `judge()` never receives the
      // step there, so this capture would hold the *expectation* text instead.
      expect(receivedSteps[0]).toBe(step);
      expect(result.status).toBe('failed');
      expect(result.steps[0]?.status).toBe('failed');
    },
  );

  it(
    'fails the step when a claim is satisfied only by a value sitting in an uncommitted control ' +
      '(task 4.2 — the unsubmitted "New project" dialog)',
    async () => {
      const page = new FakePage();
      const step = 'verify "Eval Gamma Project" is visible in the projects list';
      // The title exists on the page, but only inside the unsubmitted dialog's
      // own textbox — never committed to the list itself.
      const snapshot = [
        '- main:',
        '  - list "Projects":',
        '    - listitem: Inbox',
        '  - dialog "New project":',
        '    - textbox "Title": Eval Gamma Project',
      ].join('\n');
      const receivedSteps: string[] = [];
      const brain: AgentBrain = {
        async nextAction() {
          return {
            action: 'assert',
            reasoning: 'checking',
            expectation: 'the Title textbox shows "Eval Gamma Project"',
          };
        },
        async judge(receivedStep, expectation, snap) {
          receivedSteps.push(receivedStep);
          return stepAnchoredJudge(receivedStep, expectation, snap);
        },
      };

      const result = await executeTest(
        page,
        makeTest({ steps: [step] }),
        baseOptions(brain, { snapshot: async () => snapshot, maxRetries: 1 }),
      );

      expect(receivedSteps[0]).toBe(step);
      expect(result.status).toBe('failed');
      expect(result.steps[0]?.reason).toContain('not committed outside an editable control');
    },
  );

  it(
    "a legitimate second attempt still passes once the step's own outcome holds — re-observation " +
      '(trustworthy-verdicts) is not undone by anchoring on the step (task 4.3)',
    async () => {
      const page = new FakePage();
      const step = 'verify "Eval Gamma Project" is visible in the projects list';
      const staleSnapshot = ['- main:', '  - list "Projects":', '    - listitem: Inbox'].join('\n');
      const settledSnapshot = [
        '- main:',
        '  - list "Projects":',
        '    - listitem: Inbox',
        '    - listitem: Eval Gamma Project',
      ].join('\n');
      let snapshotCalls = 0;
      const receivedSteps: string[] = [];
      const brain: AgentBrain = {
        async nextAction() {
          return {
            action: 'assert',
            reasoning: 'checking',
            expectation: '"Eval Gamma Project" appears in the projects list',
          };
        },
        async judge(receivedStep, expectation, snap) {
          receivedSteps.push(receivedStep);
          return stepAnchoredJudge(receivedStep, expectation, snap);
        },
      };

      const result = await executeTest(
        page,
        makeTest({ steps: [step] }),
        baseOptions(brain, {
          snapshot: async () => {
            snapshotCalls++;
            return snapshotCalls === 1 ? staleSnapshot : settledSnapshot;
          },
        }),
      );

      expect(result.status).toBe('passed');
      expect(result.steps[0]?.status).toBe('passed');
      // Both the primary judgment and the re-observation received the SAME
      // step — anchoring on the step is not a one-shot check.
      expect(receivedSteps).toHaveLength(2);
      expect(receivedSteps[0]).toBe(step);
      expect(receivedSteps[1]).toBe(step);
    },
  );

  it("the model's expectation and the judge's reason are still recorded and reported (task 4.5)", async () => {
    const page = new FakePage();
    const brain = scriptedBrain(
      [{ action: 'assert', reasoning: 'checking totals', expectation: 'total shows $80' }],
      [{ pass: true, reason: 'a $80 total line is visible' }],
    );
    const events: ExecutorEvent[] = [];

    const result = await executeTest(page, makeTest(), baseOptions(brain, { onEvent: (e) => events.push(e) }));

    expect(result.status).toBe('passed');
    const actionEvent = events.find((e) => e.type === 'action');
    expect(actionEvent?.type).toBe('action');
    if (actionEvent?.type === 'action') {
      // The model's own expectation is still on the emitted action...
      expect(actionEvent.action.expectation).toBe('total shows $80');
      // ...and the judge's reason still ends up in the reported result string.
      expect(actionEvent.result).toContain('a $80 total line is visible');
    }
  });

  // Regression #2, found only against a real model after the first two unit
  // suites went green (the auth.verify fix above was regression #1): anchoring
  // on the step made an ACTION-shaped step ("submit the login form") fail
  // exactly when it succeeded, because succeeding is what makes the form the
  // step names disappear. `stepAnchoredJudge` above models entered-vs-committed
  // (design D2) but not this — it would have found nothing to match once the
  // login form's own controls were gone, and failed here too. This one models
  // the added clause instead: an action-shaped step is satisfied by the
  // absence of a failure signal, not by the continued presence of its own
  // named control.
  function actionOutcomeJudge(step: string, expectation: string, snapshot: string): AssertJudgment {
    const failureSignal = /error|invalid|validation/i.test(snapshot);
    return failureSignal
      ? { pass: false, reason: `snapshot shows a failure signal for "${step}" (offered: ${expectation})` }
      : { pass: true, reason: `no failure signal; "${step}" is treated as having taken effect (offered: ${expectation})` };
  }

  it(
    'passes an action-shaped step once its own named control is gone from a page showing no failure signal ' +
      '(the "submit the login form" regression — a successful action, not an unverifiable one)',
    async () => {
      const page = new FakePage();
      const step = 'submit the login form';
      // The login form is gone; the page has moved on to a signed-in
      // dashboard — exactly what a successful submission produces, and
      // exactly the shape that failed against a real model when the judge
      // required the form's own controls to still be present.
      const snapshot = [
        '- main:',
        '  - heading "Good afternoon, ***"',
        '  - list "Projects":',
        '    - listitem: Inbox',
      ].join('\n');
      const receivedSteps: string[] = [];
      const brain: AgentBrain = {
        async nextAction() {
          return { action: 'assert', reasoning: 'checking', expectation: 'the login form has been submitted' };
        },
        async judge(receivedStep, expectation, snap) {
          receivedSteps.push(receivedStep);
          return actionOutcomeJudge(receivedStep, expectation, snap);
        },
      };

      const result = await executeTest(page, makeTest({ steps: [step] }), baseOptions(brain, { snapshot: async () => snapshot }));

      expect(receivedSteps[0]).toBe(step);
      expect(result.status).toBe('passed');
    },
  );

  it('still fails an action-shaped step when the page shows an explicit failure signal, not merely a changed one', async () => {
    // Kept narrow (task 3.2-style guard, applied to this third clause too):
    // a real failure signal must still fail the step — this must not become
    // "any page change (or none) means the step passed".
    const page = new FakePage();
    const step = 'submit the login form';
    const snapshot = [
      '- main:',
      '  - alert "Invalid username or password"',
      '  - textbox "Username Or Email Address"',
      '  - textbox "Password"',
    ].join('\n');
    const brain: AgentBrain = {
      async nextAction() {
        return { action: 'assert', reasoning: 'checking', expectation: 'the login form has been submitted' };
      },
      async judge(step, expectation, snap) {
        return actionOutcomeJudge(step, expectation, snap);
      },
    };

    const result = await executeTest(page, makeTest({ steps: [step] }), baseOptions(brain, {
      snapshot: async () => snapshot,
      maxRetries: 1,
    }));

    expect(result.status).toBe('failed');
    expect(result.steps[0]?.reason).toContain('failure signal');
  });
});

// --- browser-patience: the snapshot cap is configurable (task 3.1/3.2/3.3) -------

describe('the accessibility snapshot cap is configurable', () => {
  it('captureSnapshot defaults to 200 lines when no cap is given', async () => {
    const raw = Array.from({ length: 250 }, (_, i) => `- text "line ${i}"`).join('\n');
    const fakePage = { locator: () => ({ ariaSnapshot: async () => raw }), url: () => 'http://x.test/' };
    const snap = await captureSnapshot(fakePage as unknown as Page);
    const lines = snap.split('\n');
    expect(lines).toHaveLength(1 + 200 + 1); // url line + 200 kept + truncation note
    expect(snap).toContain('truncated after 200 lines');
  });

  it('a raised cap admits more lines than the default', async () => {
    const raw = Array.from({ length: 250 }, (_, i) => `- text "line ${i}"`).join('\n');
    const fakePage = { locator: () => ({ ariaSnapshot: async () => raw }), url: () => 'http://x.test/' };
    const snap = await captureSnapshot(fakePage as unknown as Page, { maxLines: 300 });
    const lines = snap.split('\n');
    expect(lines).toHaveLength(1 + 250); // every line admitted, no truncation
    expect(snap).not.toContain('truncated');
  });

  it("executeTest's default snapshotter honours maxSnapshotLines, unset behaves exactly as before", async () => {
    const page = new FakePage();
    page.snapshotYaml = Array.from({ length: 50 }, (_, i) => `- text "line ${i}"`).join('\n');
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

    // Deliberately not `baseOptions`: that injects a stub `snapshot`, which would
    // bypass the real default-snapshotter path (`defaultSnapshot`/`captureSnapshot`)
    // this test exercises via `page.snapshotYaml`/`page.locator()`.
    await executeTest(page, makeTest(), { brain, sessionDir, baseUrl: 'http://x.test', timeoutMs: DEFAULT_TEST_TIMEOUT_MS });

    expect(seenSnapshot).not.toContain('truncated'); // default preserved, well under 200
  });

  it("executeTest's default snapshotter truncates at a lowered maxSnapshotLines, visibly marked", async () => {
    const page = new FakePage();
    page.snapshotYaml = Array.from({ length: 50 }, (_, i) => `- text "line ${i}"`).join('\n');
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

    // Same reason as above: no `baseOptions` here, so the real default snapshotter
    // (and therefore `maxSnapshotLines`) is actually exercised.
    await executeTest(page, makeTest(), {
      brain,
      sessionDir,
      baseUrl: 'http://x.test',
      timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
      maxSnapshotLines: 10,
    });

    expect(seenSnapshot).toContain('truncated after 10 lines');
  });
});

// --- snapshot trimming ------------------------------------------------------

describe('trimSnapshot', () => {
  it('drops empty containers, including newly emptied parents', () => {
    const yaml = [
      '- main:',
      '  - group:',
      '    - group:',
      '  - button "Save"',
    ].join('\n');
    expect(trimSnapshot(yaml)).toBe(['- main:', '  - button "Save"'].join('\n'));
  });

  it('keeps non-empty containers and leaves', () => {
    const yaml = ['- navigation:', '  - link "Home"', '- button "Go"'].join('\n');
    expect(trimSnapshot(yaml)).toBe(yaml);
  });

  it('caps the line count with a truncation note', () => {
    const yaml = Array.from({ length: 30 }, (_, i) => `- text "line ${i}"`).join('\n');
    const trimmed = trimSnapshot(yaml, 10);
    expect(trimmed.split('\n')).toHaveLength(11);
    expect(trimmed).toContain('truncated after 10 lines');
  });
});

describe('screenshot naming', () => {
  it('distinguishes two failing tests that share a summary', async () => {
    // The slug alone collided, so the second failure silently overwrote the
    // first one's evidence — exactly when you need both.
    const dir = await mkdtemp(path.join(tmpdir(), 'blastproof-shots-'));
    try {
      const failing: AgentBrain = {
        async nextAction() {
          return { action: 'fail', reasoning: 'nope' };
        },
        async judge() {
          return { pass: false, reason: 'nope' };
        },
      };
      const shots: string[] = [];
      for (const file of ['a.yaml', 'b.yaml']) {
        const page = new FakePage();
        await executeTest(
          page,
          {
            path: file,
            summary: 'Same summary',
            steps: ['do it'],
            priority: 'P1',
            tags: [],
            routes: [],
            auth: true,
          },
          baseOptions(failing, { sessionDir: dir, baseUrl: 'http://localhost:4173', snapshot: async () => '- main' }),
        );
        shots.push(...page.screenshots);
      }
      expect(shots).toHaveLength(2);
      expect(new Set(shots).size).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// --- contained recovery -------------------------------------------------------
//
// A failing step used to write to the application under test more than once:
// the commit succeeded, the redirect returned the same page with the form
// reset, the judge read that as "nothing happened", and recovery submitted
// again — twice on Gitea, and on our own demo app with a value the model
// invented (#28). These pin the guarantee that replaced that.

describe('executeTest recovery containment', () => {
  /** A brain whose every `nextAction` input is captured, for prompt assertions. */
  function recordingBrain(
    script: AgentAction[],
    judgments: AssertJudgment[],
  ): AgentBrain & { inputs: AgentIterationInput[] } {
    let calls = 0;
    let judged = 0;
    const inputs: AgentIterationInput[] = [];
    return {
      inputs,
      async nextAction(input: AgentIterationInput): Promise<AgentAction> {
        inputs.push(input);
        const next = script[calls++];
        if (!next) throw new Error('script exhausted');
        return next;
      },
      async judge(): Promise<AssertJudgment> {
        const next = judgments[judged++];
        if (!next) throw new Error('judgment script exhausted');
        return next;
      },
    };
  }

  const assertAction = (expectation = 'the note was added'): AgentAction => ({
    action: 'assert',
    reasoning: 'check',
    expectation,
  });

  it('refuses a commit already performed in this step, once a judgment has failed', async () => {
    const page = new FakePage();
    page.visible.add('role:button|Add note');
    // The reproduction, in order: the commit succeeds, the judgment fails
    // against the reset form, and the model proposes the identical click again.
    const brain = recordingBrain(
      [click('Add note'), assertAction(), click('Add note'), { action: 'fail', reasoning: 'gave up' }],
      [
        { pass: false, reason: 'the form is empty' },
        { pass: false, reason: 'the form is empty' },
      ],
    );
    const events: ExecutorEvent[] = [];

    const result = await executeTest(page, makeTest(), baseOptions(brain, { onEvent: (e) => events.push(e) }));

    // The second click never reached the page — one click, not two.
    expect(page.calls.filter((c) => c.startsWith('click'))).toHaveLength(1);
    // And the model was told, rather than the step being failed outright.
    const refusals = events.filter((e) => e.type === 'action' && e.result.startsWith('refused:'));
    expect(refusals).toHaveLength(1);
    expect(result.status).toBe('failed');
  });

  it('refuses a repeated commit even when no judgment has failed', async () => {
    const page = new FakePage();
    page.visible.add('role:button|Add note');
    // The exact sequence the demo-app reproduction produced with a real model:
    // commit, re-fill, commit again, with no assertion anywhere in between.
    // Scoping the guarantee to "after a failed judgment" left this untouched
    // and the duplicate note was written — hence no such condition.
    const fill = (value: string): AgentAction => ({
      action: 'fill',
      target: { role: 'textbox', name: 'Note' },
      value,
      reasoning: 'type',
    });
    page.visible.add('role:textbox|Note');
    const brain = recordingBrain(
      [click('Add note'), fill('Test note'), click('Add note'), { action: 'fail', reasoning: 'gave up' }],
      [],
    );
    const events: ExecutorEvent[] = [];

    await executeTest(page, makeTest(), baseOptions(brain, { onEvent: (e) => events.push(e) }));

    expect(page.calls.filter((c) => c.startsWith('click'))).toHaveLength(1);
    expect(events.filter((e) => e.type === 'action' && e.result.startsWith('refused:'))).toHaveLength(1);
  });

  it('does not carry the record across step boundaries', async () => {
    const page = new FakePage();
    page.visible.add('role:button|Add note');
    const brain = recordingBrain(
      [
        // Step one commits and closes on a passing judgment; step two must then
        // start with no memory of it. A failing step ends the test, so the
        // boundary can only be observed across a step that succeeded.
        click('Add note'),
        assertAction(),
        { action: 'done', reasoning: 'move on' },
      ],
      [{ pass: true, reason: 'fine' }],
    );

    await executeTest(page, makeTest({ steps: ['one', 'two'] }), baseOptions(brain));

    // Two steps ran; the second saw an empty history rather than the first's.
    const secondStepInputs = brain.inputs.filter((i) => i.step === 'two');
    expect(secondStepInputs).not.toHaveLength(0);
    expect(secondStepInputs[0]?.stepHistory ?? []).toHaveLength(0);
  });

  it('still allows navigate and fill while recovering', async () => {
    const page = new FakePage();
    page.visible.add('role:textbox|Note');
    const fill = (value: string): AgentAction => ({
      action: 'fill',
      target: { role: 'textbox', name: 'Note' },
      value,
      reasoning: 'type',
    });
    const brain = recordingBrain(
      [
        fill('a note'),
        assertAction(),
        // Recovering: restoring preconditions must remain possible, or the
        // model loses its only way back to a usable state (design D1).
        { action: 'navigate', value: '/notes', reasoning: 'go back' },
        fill('a note'),
        { action: 'fail', reasoning: 'gave up' },
      ],
      [
        { pass: false, reason: 'not yet' },
        { pass: false, reason: 'not yet' },
      ],
    );

    await executeTest(page, makeTest(), baseOptions(brain));

    expect(page.calls.filter((c) => c.startsWith('fill'))).toHaveLength(2);
    expect(page.calls.filter((c) => c.startsWith('goto'))).toHaveLength(2); // initial goto + the navigate
  });

  it('fails the step on the retry budget rather than the iteration ceiling when refusals repeat', async () => {
    const page = new FakePage();
    page.visible.add('role:button|Add note');
    const brain = recordingBrain(
      [click('Add note'), assertAction(), click('Add note'), click('Add note'), click('Add note')],
      [
        { pass: false, reason: 'no' },
        { pass: false, reason: 'no' },
      ],
    );

    const result = await executeTest(
      page,
      makeTest(),
      baseOptions(brain, { maxRetries: 3, maxIterationsPerStep: 15 }),
    );

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('refused:');
    expect(result.reason).not.toContain('exceeded');
    expect(page.calls.filter((c) => c.startsWith('click'))).toHaveLength(1);
  });

  it('records and compares a placeholder unresolved, and never retains the substituted value', async () => {
    const page = new FakePage();
    page.visible.add('role:button|Sign in');
    page.visible.add('role:textbox|Password');
    const brain = recordingBrain(
      [
        { action: 'fill', target: { role: 'textbox', name: 'Password' }, value: '{{env.PW}}', reasoning: 'type' },
        click('Sign in'),
        assertAction(),
        click('Sign in'),
        { action: 'fail', reasoning: 'gave up' },
      ],
      [
        { pass: false, reason: 'no' },
        { pass: false, reason: 'no' },
      ],
    );

    await executeTest(
      page,
      makeTest(),
      baseOptions(brain, {
        resolveValue: (v) => v.replace('{{env.PW}}', 's3cret'),
        mask: (s) => s.replaceAll('s3cret', '***'),
      }),
    );

    // The repeat was still caught even though the value the page received was
    // substituted: identity is the unresolved payload.
    expect(page.calls.filter((c) => c.startsWith('click'))).toHaveLength(1);
    const history = brain.inputs.flatMap((i) => i.stepHistory ?? []);
    expect(history.some((h) => h.action.includes('{{env.PW}}'))).toBe(true);
    expect(JSON.stringify(history)).not.toContain('s3cret');
  });

  it('shows the model what it already did in this step, masked', async () => {
    const page = new FakePage();
    page.visible.add('role:textbox|Password');
    const brain = recordingBrain(
      [
        { action: 'fill', target: { role: 'textbox', name: 'Password' }, value: 's3cret', reasoning: 'type s3cret' },
        { action: 'done', reasoning: 'typed' },
      ],
      [],
    );

    await executeTest(page, makeTest(), baseOptions(brain, { mask: (s) => s.replaceAll('s3cret', '***') }));

    // The second turn sees the first action; the secret is redacted on the same
    // boundary as the snapshot and lastResult.
    const secondTurn = brain.inputs[1];
    expect(secondTurn?.stepHistory).toHaveLength(1);
    expect(JSON.stringify(secondTurn?.stepHistory)).not.toContain('s3cret');
    expect(secondTurn?.stepHistory?.[0]?.action).toContain('***');
  });
});

describe('StepRecovery commit keys', () => {
  const perform = (action: AgentAction) => {
    const recovery = new StepRecovery();
    recovery.record(action, describeAction(action), 'ok');
    return recovery.refusalFor(action);
  };

  it('guards a repeated Enter, which submits', () => {
    expect(perform({ action: 'press', value: 'Enter', reasoning: 'submit' })).toBeDefined();
  });

  it('leaves repeated navigation keys alone', () => {
    // Walking a page with repeated Tab is legitimate repetition; guarding every
    // `press` broke exactly that and is why COMMIT_KEYS exists.
    for (const key of ['Tab', 'Escape', 'ArrowDown']) {
      expect(perform({ action: 'press', value: key, reasoning: 'move' })).toBeUndefined();
    }
  });
});

// --- the boundary holds where the page is -------------------------------------
//
// `assertAllowedOrigin` checked the URL a `navigate` asked for and nothing else,
// so a 302 to another host, or a click on a foreign link, carried the agent out
// of the application and the run reported PASS (#3). Both were reproduced with a
// real model against two local origins before this was written.

describe('executeTest origin boundary', () => {
  function brainRecording(script: AgentAction[]): AgentBrain & { snapshots: string[] } {
    let calls = 0;
    const snapshots: string[] = [];
    return {
      snapshots,
      async nextAction(input: AgentIterationInput): Promise<AgentAction> {
        snapshots.push(input.snapshot);
        const next = script[calls++];
        if (!next) throw new Error('script exhausted');
        return next;
      },
      async judge(): Promise<AssertJudgment> {
        return { pass: true, reason: 'fine' };
      },
    };
  }

  /** A page that lands somewhere else the moment it is asked to go anywhere. */
  class RedirectingPage extends FakePage {
    constructor(private readonly landsAt: string) {
      super();
    }
    override async goto(url: string): Promise<void> {
      this.calls.push(`goto ${url}`);
      this.currentUrl = this.landsAt;
    }
  }

  it('fails the step when a redirect has carried the page off the allowed origin', async () => {
    const page = new RedirectingPage('http://elsewhere.test/landing');
    const brain = brainRecording([{ action: 'done', reasoning: 'never reached' }]);

    const result = await executeTest(page, makeTest(), baseOptions(brain, { baseUrl: 'http://app.test' }));

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('http://elsewhere.test');
    expect(result.reason).toContain('allowed_origins');
  });

  it('never sends the content of an out-of-bounds page to the model', async () => {
    // The property that matters. The request has already happened by the time we
    // find out; what this change controls is that the response is not read into
    // a prompt while the context still holds the application's session.
    const page = new RedirectingPage('http://elsewhere.test/landing');
    const brain = brainRecording([{ action: 'done', reasoning: 'never reached' }]);

    await executeTest(
      page,
      makeTest(),
      baseOptions(brain, {
        baseUrl: 'http://app.test',
        snapshot: async () => 'url: http://elsewhere.test/landing\n- heading "Outside the application"',
      }),
    );

    expect(brain.snapshots).toHaveLength(0);
  });

  it('allows an origin the configuration declares', async () => {
    const page = new RedirectingPage('https://auth.example.com/sso');
    const brain = brainRecording([{ action: 'done', reasoning: 'signed in' }]);

    const result = await executeTest(
      page,
      makeTest(),
      baseOptions(brain, { baseUrl: 'http://app.test', allowedOrigins: ['https://auth.example.com'] }),
    );

    expect(result.status).toBe('passed');
  });

  it('treats about:blank as inside the boundary', () => {
    const allowed = allowedOriginsFor('http://app.test', undefined);
    expect(isOriginAllowed('about:blank', allowed)).toBe(true);
  });

  it('does not treat a URL with no comparable origin as allowed', () => {
    // "No origin to compare" must not mean "fine" — that permissiveness is what
    // produced this defect in the first place.
    const allowed = allowedOriginsFor('http://app.test', undefined);
    expect(isOriginAllowed('file:///etc/passwd', allowed)).toBe(false);
    expect(isOriginAllowed('not a url at all', allowed)).toBe(false);
  });

  it('still refuses a navigate action to a foreign origin, with the same message', async () => {
    const page = new FakePage();
    await expect(
      performAction(
        page,
        { action: 'navigate', value: 'https://elsewhere.example.com/x', reasoning: 'go' },
        { baseUrl: 'http://app.test' },
      ),
    ).rejects.toThrow(/Refusing to navigate outside the application: https:\/\/elsewhere\.example\.com/);
    expect(page.calls.filter((c) => c.startsWith('goto'))).toHaveLength(0);
  });
});
