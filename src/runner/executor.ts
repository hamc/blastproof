import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { AgentBrain } from '../llm/brain.js';
import type { AgentAction } from '../llm/schemas.js';
import type { TestFile } from './testfile.js';
import { performAction, type PageLike } from './actions.js';

export interface StepResult {
  step: string;
  setup: boolean;
  status: 'passed' | 'failed';
  iterations: number;
  failedAttempts: number;
  reason?: string;
  durationMs: number;
}

export interface TestResult {
  file: string;
  summary: string;
  priority: string;
  tags: string[];
  status: 'passed' | 'failed';
  steps: StepResult[];
  /** Failing step text + reason, for summary reporting. */
  failedStep?: string;
  reason?: string;
  screenshot?: string;
  durationMs: number;
}

export type ExecutorEvent =
  | { type: 'step-start'; index: number; total: number; step: string; setup: boolean }
  | { type: 'action'; index: number; action: AgentAction; result: string }
  | { type: 'step-end'; index: number; status: 'passed' | 'failed'; reason?: string };

export interface ExecutorOptions {
  brain: AgentBrain;
  /** Session directory for failure screenshots, e.g. `.blastproof/reports/<session>`. */
  sessionDir: string;
  baseUrl: string;
  /** Extra origins the agent may navigate to; `baseUrl`'s own is always allowed. */
  allowedOrigins?: string[];
  /** Expands `{{env.*}}` in action payloads at action time, never before. */
  resolveValue?: (value: string) => string;
  /** Budget of failed attempts per step (self-healing retries). Default 3. */
  maxRetries?: number;
  /** Hard cap on LLM actions per step. Default 15. */
  maxIterationsPerStep?: number;
  /** Masks secrets from every emitted/logged string. */
  mask?: (text: string) => string;
  /** Injectable snapshotter (defaults to live ariaSnapshot via {@link defaultSnapshot}). */
  snapshot?: (page: PageLike) => Promise<string>;
  onEvent?: (event: ExecutorEvent) => void;
}

/** Live snapshot via Playwright ariaSnapshot; kept here so tests can inject a fake. */
export async function defaultSnapshot(page: PageLike): Promise<string> {
  const { captureSnapshot } = await import('./snapshot.js');
  return captureSnapshot(page as never);
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'test';
}

class StepFailure extends Error {}

/**
 * Executes one test against a page from a fresh browser context.
 * The loop per step: snapshot → LLM action → perform → repeat, until
 * done/fail or budget exhaustion (design D3, spec agentic-execution).
 */
export async function executeTest(page: PageLike, test: TestFile, options: ExecutorOptions): Promise<TestResult> {
  const {
    brain,
    sessionDir,
    baseUrl,
    allowedOrigins,
    resolveValue,
    maxRetries = 3,
    maxIterationsPerStep = 15,
    mask = (s: string) => s,
    snapshot = defaultSnapshot,
    onEvent = () => {},
  } = options;

  const startedAt = Date.now();
  const stepResults: StepResult[] = [];
  const allSteps = [
    ...(test.setup ?? []).map((step) => ({ step, setup: true })),
    ...test.steps.map((step) => ({ step, setup: false })),
  ];

  const emitAction = (index: number, action: AgentAction, result: string): void => {
    // The payload may contain substituted secrets — mask before it reaches any output channel.
    const maskedAction: AgentAction = {
      ...action,
      value: action.value === undefined ? undefined : mask(action.value),
      reasoning: mask(action.reasoning),
      expectation: action.expectation === undefined ? undefined : mask(action.expectation),
    };
    onEvent({ type: 'action', index, action: maskedAction, result: mask(result) });
  };

  let failure: { step: string; reason: string } | undefined;

  // Every test starts from the configured base_url (spec: browser lifecycle).
  await page.goto(new URL(baseUrl).toString());

  for (let index = 0; index < allSteps.length; index++) {
    const { step, setup } = allSteps[index]!;
    const stepStartedAt = Date.now();
    onEvent({ type: 'step-start', index, total: allSteps.length, step: mask(step), setup });

    let iterations = 0;
    let failedAttempts = 0;
    let lastResult: string | undefined;
    let stepFailedReason: string | undefined;

    try {
      while (true) {
        if (iterations >= maxIterationsPerStep) {
          throw new StepFailure(`step exceeded ${maxIterationsPerStep} actions without completing`);
        }

        const snap = await snapshot(page);

        let action: AgentAction;
        try {
          action = await brain.nextAction({
            step,
            isSetup: setup,
            snapshot: snap,
            lastResult,
            retriesLeft: maxRetries - failedAttempts,
            iterationsLeft: maxIterationsPerStep - iterations,
          });
        } catch (error) {
          // Malformed model output counts as a failed attempt (spec: structured output).
          failedAttempts++;
          lastResult = `error: ${error instanceof Error ? error.message : String(error)}`;
          if (failedAttempts >= maxRetries) {
            throw new StepFailure(`retry budget exhausted (${maxRetries}): ${lastResult}`);
          }
          continue;
        }
        iterations++;

        if (action.action === 'done') {
          emitAction(index, action, action.reasoning);
          break;
        }

        if (action.action === 'fail') {
          emitAction(index, action, action.reasoning);
          throw new StepFailure(action.reasoning);
        }

        if (action.action === 'assert') {
          const expectation = action.expectation ?? action.reasoning;
          const judgment = await brain.judge(expectation, snap);
          const result = judgment.pass
            ? `ok: assertion passed: ${judgment.reason}`
            : `assertion failed: ${judgment.reason}`;
          emitAction(index, action, result);
          if (judgment.pass) {
            lastResult = result;
            continue;
          }
          // A failed judgment may just mean the page hasn't settled: retry within budget.
          failedAttempts++;
          lastResult = result;
          if (failedAttempts >= maxRetries) {
            throw new StepFailure(judgment.reason);
          }
          continue;
        }

        try {
          const result = await performAction(page, action, { baseUrl, allowedOrigins, resolveValue });
          lastResult = result;
          emitAction(index, action, result);
        } catch (error) {
          // Self-healing: fresh snapshot next iteration, up to the retry budget.
          failedAttempts++;
          lastResult = `error: ${error instanceof Error ? error.message : String(error)}`;
          emitAction(index, action, lastResult);
          if (failedAttempts >= maxRetries) {
            throw new StepFailure(lastResult);
          }
        }
      }
    } catch (error) {
      // Mask everything that reaches logs/reports, regardless of throw site.
      stepFailedReason = mask(error instanceof Error ? error.message : String(error));
    }

    const status = stepFailedReason ? ('failed' as const) : ('passed' as const);
    stepResults.push({
      step: mask(step), // results are a report channel — never store substituted secrets
      setup,
      status,
      iterations,
      failedAttempts,
      reason: stepFailedReason,
      durationMs: Date.now() - stepStartedAt,
    });
    onEvent({ type: 'step-end', index, status, reason: stepFailedReason });

    if (stepFailedReason) {
      failure = { step: mask(step), reason: stepFailedReason };
      break; // stop at the first failing step; remaining steps are not executed
    }
  }

  let screenshot: string | undefined;
  if (failure) {
    try {
      await mkdir(sessionDir, { recursive: true });
      // The slug alone collides when two tests share a summary (or its first 60
      // chars), silently overwriting one failure's evidence with another's.
      const stem = `${slugify(test.summary)}-${slugify(path.basename(test.path))}`;
      const file = path.join(sessionDir, `${stem}.png`);
      await page.screenshot({ path: file, fullPage: true });
      screenshot = file;
    } catch {
      // never let a screenshot failure mask the real test failure
    }
  }

  return {
    file: test.path,
    summary: test.summary,
    priority: test.priority,
    tags: test.tags,
    status: failure ? 'failed' : 'passed',
    steps: stepResults,
    failedStep: failure?.step,
    reason: failure?.reason,
    screenshot,
    durationMs: Date.now() - startedAt,
  };
}
