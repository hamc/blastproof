import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { AgentBrain } from '../llm/brain.js';
import type { AgentAction } from '../llm/schemas.js';
import { BudgetExhaustedError } from './budget.js';
import type { TestFile } from './testfile.js';
import { performAction, type PageLike } from './actions.js';

/** Hard cap on LLM actions per step, when not overridden. Also the number the
 * dry-run ceiling (design D5, `estimateMaxModelCalls`) is derived from, so the
 * two never drift apart. */
export const DEFAULT_MAX_ITERATIONS_PER_STEP = 15;

/**
 * Bounds how long a single settling attempt waits for network idle before a
 * snapshot (design D1, trustworthy-verdicts). Deliberately its own short
 * budget, NOT `browser.timeout_ms`: only `networkidle` actually narrows the
 * window that produces a stale-snapshot false FAIL — `domcontentloaded` and
 * `load` were measured (task group 1's own demo-app reproduction) to return
 * in about a millisecond on the page still being replaced, so they do not
 * wait at all — but `networkidle` is also the load state most likely to
 * never arrive (a websocket, a poll, an SSE stream). Tying it to
 * `browser.timeout_ms` (30s by default) would let a single non-idling page
 * cost 30s on *every* snapshot; a 25-step run could spend twelve minutes
 * waiting to learn nothing.
 *
 * 2000ms is chosen because the group 1 reproduction needed roughly 1.1s to
 * settle (the demo app's real 600ms server delay plus Playwright's own
 * ~500ms network-idle debounce); doubling that leaves comfortable headroom
 * for a slower CI machine while keeping the worst case for a page that never
 * idles an order of magnitude below the old 30s bound.
 *
 * Exceeding it is normal, not an error: the snapshot is simply taken as it
 * is today. The asymmetry that makes a short, silent bound safe is that
 * waiting too little only reintroduces the defect for slower round-trips,
 * while waiting too long taxes every step of every run — so this fails
 * toward today's behaviour, never toward a hang.
 */
export const SETTLE_TIMEOUT_MS = 2_000;

/**
 * Waits for the page to settle before the caller takes a snapshot, bounded by
 * {@link SETTLE_TIMEOUT_MS} (design D1). Applied unconditionally, before
 * every snapshot, rather than only after actions believed to navigate: the
 * accessibility tree cannot distinguish a click on a link, a submit button,
 * or a JS handler that may or may not navigate, so guessing which actions
 * need it reintroduces the defect on exactly the case guessed wrong.
 *
 * A single settle call is not always enough for the fetch-then-navigate shape
 * task group 1's reproduction uses (`fetch(...).then(() => location.href = …)`):
 * a wait started right after the triggering action can, in principle, observe
 * the fetch's own network activity go idle and resolve before the navigation
 * it schedules has started or fully landed. So if settling changed the URL,
 * it is applied once more, bounded by whatever remains of this call's own
 * budget — never exceeding {@link SETTLE_TIMEOUT_MS} in total, even when two
 * waits are needed to observe the destination page settle.
 */
async function waitForSettled(page: PageLike): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  const urlBefore = page.url();
  await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {
    // Silent by design (see the budget comment above): today's behaviour —
    // a snapshot taken as-is — is what a timeout falls back to.
  });
  if (page.url() === urlBefore) return;
  const remaining = deadline - Date.now();
  if (remaining > 0) {
    await page.waitForLoadState('networkidle', { timeout: remaining }).catch(() => {});
  }
}

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
  /**
   * `not-run` is a run stopped by its budget or deadline before this test executed
   * (design D3, spec run-budget) — distinct from `failed`, since exhaustion says
   * nothing about the application under test.
   */
  status: 'passed' | 'failed' | 'not-run';
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
  /**
   * The configured `browser.timeout_ms` (design D1/D2): threaded into the
   * `ActionContext` built for every `performAction` call, so it bounds resolving a
   * target element and navigating, not only the click/fill that follows a
   * successful resolution.
   *
   * Required, not optional. There is no legitimate production reason to run
   * without it — both real callers (`run`, `auth`'s login journey) always have the
   * configured value on hand — and an unset value has no sensible "don't care"
   * meaning here the way an unbounded `RunBudget` does for `budget`: it would
   * silently fall back to `performAction`/`resolveTarget`'s own fixed defaults (2s
   * resolution, 30s navigation), quietly reinstating the exact defect this option
   * exists to close. This is the second time an optional field meant to close a
   * gap discovered at one call site was silently left unset at another (`budget`
   * missed `plan`, this once missed `auth`); making it required turns that class
   * of omission into a compile error instead of a silent regression.
   */
  timeoutMs: number;
  /** Masks secrets from every emitted/logged string. */
  mask?: (text: string) => string;
  /** Injectable snapshotter (defaults to live ariaSnapshot via {@link defaultSnapshot}). */
  snapshot?: (page: PageLike) => Promise<string>;
  /**
   * Caps accessibility-tree lines sent to the model per snapshot (design: the
   * snapshot cap is configurable). Only applies to the default snapshotter above;
   * an injected `snapshot` fully replaces it. Undefined keeps `captureSnapshot`'s
   * own default (200 lines).
   */
  maxSnapshotLines?: number;
  onEvent?: (event: ExecutorEvent) => void;
}

/** Live snapshot via Playwright ariaSnapshot; kept here so tests can inject a fake. */
export async function defaultSnapshot(page: PageLike, maxLines?: number): Promise<string> {
  const { captureSnapshot } = await import('./snapshot.js');
  return captureSnapshot(page as never, { maxLines });
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
    maxIterationsPerStep = DEFAULT_MAX_ITERATIONS_PER_STEP,
    timeoutMs,
    mask = (s: string) => s,
    snapshot,
    maxSnapshotLines,
    onEvent = () => {},
  } = options;
  // The default snapshotter alone honours `maxSnapshotLines`; an injected fake
  // (every unit test) fully replaces it and ignores the cap, as before.
  const takeSnapshot = snapshot ?? ((page: PageLike) => defaultSnapshot(page, maxSnapshotLines));

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

        // A verdict must describe the page the previous action produced, not
        // one still mid-navigation (design D1): wait for the page to settle
        // before every snapshot, unconditionally — see `waitForSettled` for
        // why this cannot be applied only to actions believed to navigate.
        await waitForSettled(page);
        const snap = await takeSnapshot(page);

        let action: AgentAction;
        try {
          // One choke point for everything crossing into the prompt. Masking each
          // assignment site was tried and got it wrong: `select` and `navigate`
          // embed the resolved value in their result string, so a secret reached
          // the model through `lastResult` while the display channel looked clean.
          // The page can render a secret too, so the snapshot is masked as well.
          action = await brain.nextAction({
            step,
            isSetup: setup,
            snapshot: mask(snap),
            lastResult: lastResult === undefined ? undefined : mask(lastResult),
            retriesLeft: maxRetries - failedAttempts,
            iterationsLeft: maxIterationsPerStep - iterations,
          });
        } catch (error) {
          // A budget/deadline stop ends the run, not this attempt (design D3): it
          // must not be spent from the retry budget or reported as a bad model
          // response, so it bypasses this handler entirely.
          if (error instanceof BudgetExhaustedError) throw error;
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
          // The step is the question; the expectation is only the claim
          // offered in support of it (design judge-the-step, D1) — a passing
          // expectation that does not establish the step's own outcome must
          // not close the step. Same masking boundary as everything else that
          // crosses into a prompt: the step text too (design D1, task 2.5).
          let judgment = await brain.judge(mask(step), mask(expectation), mask(snap));
          if (!judgment.pass) {
            // Re-observe before handing control back to the model (design D3):
            // the settle wait above is bounded and can time out silently, so a
            // failed judgment can still land on a page mid-navigation. Look
            // again — a fresh settle wait, a fresh snapshot, the SAME step and
            // expectation re-judged — before concluding it really failed. This
            // is the loop doing what its own comment used to only claim: the
            // old code said a failed judgment "may just mean the page hasn't
            // settled" and then returned straight to `nextAction` anyway, which
            // is what let the model invent an action instead of looking again.
            await waitForSettled(page);
            const freshSnap = await takeSnapshot(page);
            judgment = await brain.judge(mask(step), mask(expectation), mask(freshSnap));
          }
          const result = judgment.pass
            ? `ok: assertion passed: ${judgment.reason}`
            : `assertion failed: ${judgment.reason}`;
          emitAction(index, action, result);
          if (judgment.pass) {
            // Terminate here, exactly as `done` does. The extra turn this used to
            // spend asking for a further action is what let the model contradict
            // its own passing assertion by emitting `fail` next (see design D1) —
            // don't reintroduce it by turning this back into a `continue`.
            lastResult = result;
            break;
          }
          // Failed against a freshly settled page, not merely a stale one: this
          // is a real retry, one unit of the existing budget — re-observation
          // above is not a second retry unit of its own, so it cannot loop
          // beyond that budget (design D3, task 3.3).
          failedAttempts++;
          lastResult = result;
          if (failedAttempts >= maxRetries) {
            throw new StepFailure(judgment.reason);
          }
          continue;
        }

        try {
          const result = await performAction(page, action, {
            baseUrl,
            allowedOrigins,
            resolveValue,
            resolveTimeoutMs: timeoutMs,
          });
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
      // A budget/deadline stop is not a step failure (design D3, spec
      // agentic-execution): let it propagate out of executeTest so the caller can
      // record this test — and the rest of the run's selection — as not run,
      // rather than manufacturing a defect that does not exist.
      if (error instanceof BudgetExhaustedError) throw error;
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
