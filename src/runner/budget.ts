/**
 * Bounds a run by model calls, tokens and wall-clock time (design D1/D2, spec
 * run-budget). Enforcement lives at the single choke point every model call
 * already passes through (`createBrain`/`createPlanner` in `src/llm/brain.ts`) —
 * the same shape as the run-wide secrets mask, and for the same reason: a limit
 * checked at a call site instead of over the whole scope is the recurring defect
 * in this codebase (secret leaks, then #15).
 *
 * Each limit is independently optional; an unconfigured one never binds, so a run
 * with no budget or deadline configured behaves exactly as it does today.
 */

export type BudgetLimit = 'calls' | 'tokens' | 'duration';

/** What a completed model call reports spending. Only the total is counted (D1). */
export interface CallUsage {
  totalTokens?: number;
}

export interface RunBudgetOptions {
  maxCalls?: number;
  maxTokens?: number;
  maxDurationMs?: number;
  /**
   * How long one model call may take before it is aborted and the run stops
   * (design bound-every-model-call, D2). Undefined never binds.
   */
  callTimeoutMs?: number;
  /** Injectable clock, so deadline behaviour is testable without real wall-clock time. */
  now?: () => number;
}

function describeLimit(limit: BudgetLimit, observed: number, configured: number): string {
  switch (limit) {
    case 'calls':
      return `model call budget exhausted: reached the configured maximum of ${configured} call(s)`;
    case 'tokens':
      return (
        `token budget exhausted: reached the configured maximum of ${configured} token(s) ` +
        `(observed ${observed})`
      );
    case 'duration':
      return (
        `deadline exceeded: reached the configured maximum of ${(configured / 1000).toFixed(0)}s ` +
        `(elapsed ${(observed / 1000).toFixed(1)}s)`
      );
  }
}

/**
 * The run stopped for a reason that says nothing about the application under
 * test (design stop-the-run-when-the-provider-refuses, D2). Every site that ends
 * a run as incomplete tests for this, never for one of its causes: a second
 * cause added beside the first would need every site found again, and the one
 * missed is the defect this codebase keeps producing.
 */
export abstract class RunStoppedError extends Error {}

/**
 * Raised when the next model call — or, in `runCommand`, the next test — could
 * exceed a configured limit (design D2/D3). Distinct from a step failure: a caller
 * catching this must end the run, not fail a test, since exhaustion says nothing
 * about the application under test. Carries the limit and the observed count, so
 * every surface that reports it (console, JUnit, HTML) can name both without
 * recomputing them.
 */
export class BudgetExhaustedError extends RunStoppedError {
  readonly limit: BudgetLimit;
  readonly observed: number;
  readonly configured: number;

  constructor(limit: BudgetLimit, observed: number, configured: number) {
    super(describeLimit(limit, observed, configured));
    this.name = 'BudgetExhaustedError';
    this.limit = limit;
    this.observed = observed;
    this.configured = configured;
  }
}

/** What to do about a refusal, decided by its status alone (design D3). */
function refusalRemedy(statusCode: number | undefined): string | undefined {
  if (statusCode === undefined) {
    return 'The provider could not be reached after 3 attempts: check llm.base_url and the network, then run again.';
  }
  if (statusCode === 401 || statusCode === 403) {
    return 'Check the API key in the variable named by llm.api_key_env, then run again.';
  }
  if (statusCode === 402) return 'Add credit to the provider account, then run again.';
  if (statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500) {
    return 'The provider was unavailable after 3 attempts: run again later.';
  }
  return undefined;
}

/**
 * The model provider answered a call with no response to use: an HTTP error
 * status, or none at all because it could not be reached (design
 * stop-the-run-when-the-provider-refuses, D1). An exhausted account, a revoked
 * key and an outage say no more about the application than an exhausted budget
 * does, and they used to be reported as failed tests, and at login as a broken
 * login (#125).
 *
 * "3 attempts" in the remedy is the AI SDK's default of two retries, which
 * nothing here overrides; it has already been spent when this is raised.
 */
export class ProviderRefusedError extends RunStoppedError {
  readonly statusCode: number | undefined;

  constructor(statusCode: number | undefined, detail: string) {
    const status = statusCode === undefined ? 'no response' : `HTTP ${statusCode}`;
    const remedy = refusalRemedy(statusCode);
    // A detail is the provider's prose and may stop mid-sentence; the remedy is a
    // sentence of its own (design count-a-malformed-judgment-as-an-attempt, D3).
    const separator = /[.!?]$/.test(detail.trim()) ? ' ' : '. ';
    super(`model provider refused the request (${status}): ${detail}${remedy ? `${separator}${remedy}` : ''}`);
    this.name = 'ProviderRefusedError';
    this.statusCode = statusCode;
  }
}

/**
 * A model call took longer than `llm.timeout_s` (design bound-every-model-call,
 * D2). It stops the run for the reason a call with no response does (#125): a
 * call that never answered says nothing about the application, and counting it
 * as a failed attempt would spend a step's retries at the timeout each.
 */
export class ModelCallTimeoutError extends RunStoppedError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    const seconds = Number((timeoutMs / 1000).toFixed(1));
    super(
      `model call timed out: no answer within ${seconds}s (llm.timeout_s). ` +
        'For a slow local model, raise llm.timeout_s in .blastproof/config.yaml or set BLASTPROOF_LLM_TIMEOUT_S; ' +
        'otherwise check that the provider is answering, then run again.',
    );
    this.name = 'ModelCallTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Counts model calls, tokens and elapsed wall-clock time against optional limits.
 * `check()` is called before spending anything — a model call, or in `runCommand`,
 * a test — so exhaustion always stops the *next* unit of work rather than being
 * discovered mid-flight. Tokens are the one exception: they are known only after a
 * call returns, so `check()` can only compare against what has already been spent,
 * and the call in flight when the limit is crossed is allowed to finish (design
 * risk, accepted and documented: overshoot bounded by one call).
 */
export class RunBudget {
  private readonly maxCalls?: number;
  private readonly maxTokens?: number;
  private readonly maxDurationMs?: number;
  /** How long one model call may take; read by `countedGenerate` (design bound-every-model-call, D2). */
  readonly callTimeoutMs?: number;
  private readonly now: () => number;
  private readonly startedAt: number;
  private calls = 0;
  private tokens = 0;
  private callsWithUsage = 0;

  constructor(options: RunBudgetOptions = {}) {
    this.maxCalls = options.maxCalls;
    this.maxTokens = options.maxTokens;
    this.maxDurationMs = options.maxDurationMs;
    this.callTimeoutMs = options.callTimeoutMs;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
  }

  /** Model calls recorded so far. */
  get callCount(): number {
    return this.calls;
  }

  /** Tokens recorded so far, summed across every completed call. */
  get tokenCount(): number {
    return this.tokens;
  }

  /**
   * Throws {@link BudgetExhaustedError} when the next unit of work could exceed a
   * configured limit. Called before spending anything, never after — so an
   * over-budget call is never issued and then rejected (spec: "the call is not
   * made").
   */
  check(): void {
    if (this.maxCalls !== undefined && this.calls >= this.maxCalls) {
      throw new BudgetExhaustedError('calls', this.calls, this.maxCalls);
    }
    if (this.maxTokens !== undefined && this.tokens >= this.maxTokens) {
      throw new BudgetExhaustedError('tokens', this.tokens, this.maxTokens);
    }
    if (this.maxDurationMs !== undefined) {
      const elapsed = this.now() - this.startedAt;
      if (elapsed >= this.maxDurationMs) {
        throw new BudgetExhaustedError('duration', elapsed, this.maxDurationMs);
      }
    }
  }

  /**
   * Milliseconds left before the deadline, or undefined without one (design
   * bound-every-model-call, D3). Lets a call in flight be aborted when the
   * deadline passes, rather than only the next call being refused.
   */
  remainingMs(): number | undefined {
    if (this.maxDurationMs === undefined) return undefined;
    return Math.max(0, this.maxDurationMs - (this.now() - this.startedAt));
  }

  /**
   * The deadline's stop, for a call its timer aborted (design
   * bound-every-model-call, D3). Not `check()`: a timer can fire a millisecond
   * before the clock `check()` reads has reached the deadline, and that call
   * then left as a timeout, failing a test in the 0.25.0 release workflow.
   */
  deadlineReached(): BudgetExhaustedError {
    const configured = this.maxDurationMs ?? 0;
    return new BudgetExhaustedError('duration', Math.max(this.now() - this.startedAt, configured), configured);
  }

  /** Records what a completed model call spent. */
  record(usage: CallUsage | undefined): void {
    this.calls += 1;
    if (usage?.totalTokens !== undefined) {
      this.tokens += usage.totalTokens;
      this.callsWithUsage += 1;
    }
  }

  /**
   * What this budget has been spent on, for every surface that reports it
   * (design report-what-it-spent, D1). One method rather than four getters read
   * separately: the console, the JUnit report and the HTML report take the same
   * numbers from the same object, so they cannot disagree about what a run cost.
   */
  spend(): BudgetSpend {
    return {
      calls: this.calls,
      maxCalls: this.maxCalls,
      tokens: this.tokens,
      callsWithUsage: this.callsWithUsage,
      maxTokens: this.maxTokens,
    };
  }
}

/**
 * What a run actually spent, for reporting (design report-what-it-spent, D1).
 *
 * `callsWithUsage` is what separates "no tokens were reported" from "no tokens
 * were spent". `tokenCount` starts at zero and is only ever incremented by a
 * value the provider supplied, so a run against a provider that reports no
 * usage ends indistinguishable from one that made no calls at all. Printing
 * `0 tokens` there is not a rounding error — it is a false statement about the
 * one thing someone is reading the line to learn.
 */
export interface BudgetSpend {
  calls: number;
  maxCalls?: number;
  tokens: number;
  /** How many completed calls reported token usage; 0 means the figure is unavailable. */
  callsWithUsage: number;
  maxTokens?: number;
}

/** The step counts an estimate needs from a test — a subset of `TestFile`. */
export interface StepCounts {
  setup?: string[];
  steps: string[];
}

/**
 * Worst-case model-call ceiling for a selection (design D5, spec run-budget: "the
 * ceiling the selection cannot exceed"). Per step it is `N + R + min(N, R)`,
 * where N is `maxIterationsPerStep` and R is `maxRetriesPerStep`.
 *
 * Per step, `executor.ts` enforces those two caps independently, and a model
 * call can spend against either or both at once:
 *   - A malformed `nextAction` response is retried — `failedAttempts++` then
 *     `continue` — *before* `iterations++` runs, so it costs one call against R
 *     alone, never touching N.
 *   - A plain action costs one call against N alone.
 *   - A **failing** `assert` costs three: `nextAction`, the judgment, and the
 *     re-judgment the executor performs against a freshly settled page before
 *     handing control back to the model (design D3, trustworthy-verdicts). It
 *     spends one unit of N and one of R for those three calls.
 *
 * Maximising calls against the two budgets is therefore a question of how many
 * of the R retry units are bundled onto an iteration rather than spent
 * standalone:
 *   - R >= N: N failing asserts (3N) + (R - N) malformed responses = 2N + R
 *   - R <  N: R failing asserts (3R) + (N - R) plain actions      = N + 2R
 * which is `N + R + min(N, R)` in both regimes.
 *
 * A forecast this is not — most steps finish in a handful of calls, long before
 * either cap binds, and a run reports what it actually spent (`RunBudget.spend`)
 * precisely because this number is the wrong one to size a budget from. On this
 * repository's own suite the ceiling is 735 calls where a real run spends about
 * 82. This is the maximum a single step's loop cannot exceed no matter how the
 * model behaves, and nothing more.
 *
 * `maxRetriesPerStep` is read from config, not assumed, because it has no upper
 * bound (`z.number().int().min(1)`) and a fixed assumption here would silently
 * stop being a ceiling the moment a config raised it.
 *
 * Keep this in step with the executor. The formula has been wrong twice. `2N`
 * undercounted once R exceeded what standalone retries could absorb below N —
 * DEF-001 measured 35 real calls against N=15, R=20, where `2N` reported 30.
 * Its replacement, `N + R`, was correct until a failing assert began costing
 * three calls rather than two. An estimate that undershoots is worse than none,
 * because a budget gets sized from it.
 */
export function estimateMaxModelCalls(
  tests: StepCounts[],
  maxIterationsPerStep: number,
  maxRetriesPerStep: number,
): number {
  const totalSteps = tests.reduce(
    (sum, test) => sum + (test.setup?.length ?? 0) + test.steps.length,
    0,
  );
  // Derivation and the two times this formula has been wrong: see above.
  return totalSteps * (maxIterationsPerStep + maxRetriesPerStep + Math.min(maxIterationsPerStep, maxRetriesPerStep));
}
