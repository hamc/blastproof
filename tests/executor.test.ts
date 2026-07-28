import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentBrain } from '../src/llm/brain.js';
import type { AgentAction, AssertJudgment } from '../src/llm/schemas.js';
import { performAction, resolveTarget, type LocatorLike, type PageLike } from '../src/runner/actions.js';
import { executeTest, type ExecutorEvent } from '../src/runner/executor.js';
import { trimSnapshot } from '../src/runner/snapshot.js';
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
    if (!this.page.visible.has(`${this.kind}:${this.query}`)) {
      throw new Error(`not visible: ${this.kind}:${this.query}`);
    }
  }

  async waitFor(): Promise<void> {
    this.resolve();
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
  screenshots: string[] = [];
  currentUrl = 'about:blank';

  keyboard = {
    press: async (key: string) => {
      this.calls.push(`keyboard ${key}`);
    },
  };

  async goto(url: string): Promise<void> {
    this.calls.push(`goto ${url}`);
    this.currentUrl = url;
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
}

function scriptedBrain(script: Array<AgentAction | Error>, judgments?: AssertJudgment[]): AgentBrain & {
  calls: number;
} {
  let calls = 0;
  let judgmentCalls = 0;
  return {
    get calls() {
      return calls;
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

// --- executor loop ----------------------------------------------------------

describe('executeTest', () => {
  it('passes a test when the LLM completes each step with done', async () => {
    const page = new FakePage();
    page.visible.add('role:button|Add to cart');
    const brain = scriptedBrain([click('Add to cart'), { action: 'done', reasoning: 'item added' }]);

    const result = await executeTest(page, makeTest(), {
      brain,
      sessionDir,
      baseUrl: 'http://localhost:4173',
      snapshot: async () => 'snap',
    });

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
      { brain, sessionDir, baseUrl: 'http://x.test', snapshot: async () => 's', onEvent: (e) => events.push(e) },
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

    const result = await executeTest(page, makeTest(), {
      brain,
      sessionDir,
      baseUrl: 'http://x.test',
      snapshot: async () => 'fresh snap',
    });

    expect(result.status).toBe('passed');
    expect(result.steps[0]?.failedAttempts).toBe(1);
    expect(brain.calls).toBe(3);
  });

  it('fails the step when the LLM returns fail, captures a screenshot, stops remaining steps', async () => {
    const page = new FakePage();
    const brain = scriptedBrain([{ action: 'fail', reasoning: 'login button is gone' }]);

    const result = await executeTest(page, makeTest({ steps: ['do a', 'do b'] }), {
      brain,
      sessionDir,
      baseUrl: 'http://x.test',
      snapshot: async () => 'snap',
    });

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

    const result = await executeTest(page, makeTest(), {
      brain,
      sessionDir,
      baseUrl: 'http://x.test',
      maxRetries: 3,
      snapshot: async () => 'snap',
    });

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

    const result = await executeTest(page, makeTest(), {
      brain,
      sessionDir,
      baseUrl: 'http://x.test',
      snapshot: async () => 'snap',
    });

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

    const result = await executeTest(page, makeTest(), {
      brain,
      sessionDir,
      baseUrl: 'http://x.test',
      snapshot: async () => 'snap',
    });

    expect(result.status).toBe('passed');
    expect(result.steps[0]?.status).toBe('passed');
  });

  it('makes no further nextAction call once an assertion passes (design D3: the economic claim)', async () => {
    const page = new FakePage();
    const brain = scriptedBrain(
      [{ action: 'assert', reasoning: 'check', expectation: 'total is $80' }],
      [{ pass: true, reason: 'total shows $80' }],
    );

    const result = await executeTest(page, makeTest(), {
      brain,
      sessionDir,
      baseUrl: 'http://x.test',
      snapshot: async () => 'snap',
    });

    expect(result.status).toBe('passed');
    expect(brain.calls).toBe(1);
  });

  it('retries a failing assertion to the budget and then fails the step, unchanged', async () => {
    const page = new FakePage();
    const failing = scriptedBrain(
      Array(3).fill({ action: 'assert', reasoning: 'check', expectation: 'total is $80' }),
      Array(3).fill({ pass: false, reason: 'no total rendered' }),
    );

    const failResult = await executeTest(page, makeTest(), {
      brain: failing,
      sessionDir,
      baseUrl: 'http://x.test',
      maxRetries: 3,
      snapshot: async () => 'snap',
    });

    expect(failResult.status).toBe('failed');
    expect(failResult.reason).toContain('no total rendered');
    expect(failResult.steps[0]?.failedAttempts).toBe(3);
  });

  it('aborts a step that exceeds the iteration cap', async () => {
    const page = new FakePage();
    const brain = scriptedBrain(Array(6).fill({ action: 'press', value: 'Tab', reasoning: 'wander' }));

    const result = await executeTest(page, makeTest(), {
      brain,
      sessionDir,
      baseUrl: 'http://x.test',
      maxIterationsPerStep: 5,
      snapshot: async () => 'snap',
    });

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

    const result = await executeTest(page, makeTest(), {
      brain,
      sessionDir,
      baseUrl: 'http://x.test',
      mask,
      snapshot: async () => 'snap',
      onEvent: (e) => events.push(e),
    });

    const serialized = JSON.stringify(events) + JSON.stringify(result);
    expect(serialized).not.toContain('s3cret');
    expect(serialized).toContain('***');
    // …but the real value reached the page
    expect(page.calls).toContain('fill role:textbox|Password=s3cret');
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
          {
            brain: failing,
            sessionDir: dir,
            baseUrl: 'http://localhost:4173',
            snapshot: async () => '- main',
          },
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
