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
 * Raised when the next model call — or, in `runCommand`, the next test — could
 * exceed a configured limit (design D2/D3). Distinct from a step failure: a caller
 * catching this must end the run, not fail a test, since exhaustion says nothing
 * about the application under test. Carries the limit and the observed count, so
 * every surface that reports it (console, JUnit, HTML) can name both without
 * recomputing them.
 */
export class BudgetExhaustedError extends Error {
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
  private readonly now: () => number;
  private readonly startedAt: number;
  private calls = 0;
  private tokens = 0;

  constructor(options: RunBudgetOptions = {}) {
    this.maxCalls = options.maxCalls;
    this.maxTokens = options.maxTokens;
    this.maxDurationMs = options.maxDurationMs;
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

  /** Records what a completed model call spent. */
  record(usage: CallUsage | undefined): void {
    this.calls += 1;
    if (usage?.totalTokens !== undefined) this.tokens += usage.totalTokens;
  }
}

/** The step counts an estimate needs from a test — a subset of `TestFile`. */
export interface StepCounts {
  setup?: string[];
  steps: string[];
}

/**
 * Worst-case model-call ceiling for a selection (design D5, spec run-budget: "the
 * ceiling the selection cannot exceed").
 *
 * Per step, `executor.ts` enforces two independent caps, `maxIterationsPerStep`
 * (N) and `maxRetriesPerStep` (R), and a model call can spend against either or
 * both at once:
 *   - A malformed `nextAction` response is retried — `failedAttempts++` then
 *     `continue` — *before* `iterations++` runs, so it costs one call against R
 *     alone, never touching N.
 *   - A successful `nextAction` always costs one call against N. If the action is
 *     `assert`, `judge()` spends a second call in the same turn; a failing
 *     judgment then also costs one unit of R, on top of the N unit already spent.
 *
 * So R-worth of calls can be spent two ways: standalone (1 call each, N
 * untouched) or bundled onto a failing assert (2 calls each, N and R both spent
 * for the price of one retry unit). Filling all N iteration slots with failing
 * asserts alone (`2N` calls) never has enough retry budget left to also cash in
 * standalone calls once `maxRetriesPerStep` is exhausted — that path is bounded
 * by `min(N, R)` bundled iterations, not N of them, unless R ≥ N. Working the
 * trade-off through (an LP over how many of the R retry units are bundled onto an
 * iteration vs. spent standalone) tops out at exactly `N + R` calls, achieved by
 * spending every iteration slot and every retry unit once each, never both on the
 * same call except where a failing assert intentionally pays for one of each.
 * `2N` (the previous formula) undercounts once R exceeds what standalone retries
 * can absorb below N — DEF-001 measured 35 real calls against N=15, R=20 (its
 * reported ceiling of 30 came from `2N` alone, ignoring R entirely). `N + R`
 * matches that measurement exactly: 15 + 20 = 35.
 *
 * A forecast this is not — most steps finish in a handful of calls, long before
 * either cap binds. This is the maximum a single step's loop cannot exceed no
 * matter how the model behaves, and `maxRetriesPerStep` is read from config, not
 * assumed, because it has no upper bound (`z.number().int().min(1)`) and a fixed
 * assumption here would silently stop being a ceiling the moment a config raised it.
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
  // N + R + min(N, R), not N + R. A failing `assert` now costs three calls, not
  // two: `nextAction`, the judgment, and the re-judgment the executor performs
  // before handing control back to the model (design D3, trustworthy-verdicts).
  //
  // Maximising calls against the two independent budgets — iterations (N) and
  // retries (R) — with a failing assert spending one of each for three calls, a
  // malformed response spending a retry alone for one, and a plain action
  // spending an iteration alone for one:
  //   R >= N: N failing asserts (3N) + (R - N) malformed  = 2N + R
  //   R <  N: R failing asserts (3R) + (N - R) actions     = N + 2R
  // which is N + R + min(N, R) in both regimes.
  //
  // This must be kept in step with the executor: DEF-001 was an estimate that
  // undershot, and an estimate that undershoots is worse than none, because a
  // budget gets sized from it.
  return totalSteps * (maxIterationsPerStep + maxRetriesPerStep + Math.min(maxIterationsPerStep, maxRetriesPerStep));
}
