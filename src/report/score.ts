import type { BudgetSpend } from '../runner/budget.js';
import type { TestResult } from '../runner/executor.js';

/** Priority weights: a failing P0 costs three times a failing P2 (design D1). */
export const WEIGHTS: Record<string, number> = { P0: 3, P1: 2, P2: 1 };

const DEFAULT_WEIGHT = WEIGHTS.P1!;

/**
 * Weighted pass rate over executed tests, rounded to an integer 0–100.
 * An empty result list scores 100: nothing ran, so nothing is at risk (design D2).
 * A test the run's budget or deadline stopped before it started (`not-run`, spec
 * run-budget) is excluded from the denominator entirely, not counted as a failure
 * — treating it as a failure would replace one lie (the run passed) with a
 * quieter one (the app broke), when neither claim has any evidence behind it
 * (design D4, risk note). Pure — the caller owns all I/O.
 */
export function computeScore(results: TestResult[]): number {
  let total = 0;
  let passed = 0;
  for (const result of results) {
    if (result.status === 'not-run') continue;
    const weight = WEIGHTS[result.priority] ?? DEFAULT_WEIGHT;
    total += weight;
    if (result.status === 'passed') passed += weight;
  }
  if (total === 0) return 100;
  return Math.round((100 * passed) / total);
}

/**
 * The summary score line. Names the threshold when one is set so the gate
 * decision is visible without recomputing it, and flags the empty case so a
 * score of 100 is never mistaken for verified quality (design D2).
 */
export function formatScoreLine(
  score: number,
  results: TestResult[],
  threshold?: number,
): string {
  if (results.length === 0) {
    const base = 'Score: 100 (no tests executed)';
    return threshold === undefined ? base : `${base} — min-score ${threshold}: pass`;
  }
  if (threshold === undefined) return `Score: ${score}`;
  return score >= threshold
    ? `Score: ${score} — min-score ${threshold}: pass`
    : `Score: ${score} — min-score ${threshold}: FAIL (below threshold)`;
}

/**
 * The summary line for a run its budget or deadline stopped (spec run-budget,
 * design D3/D4). States the stop plainly instead of an ordinary score line: the
 * executed tests are whichever happened to run first, not a verdict, and
 * `--min-score` never overrides this — the process exits non-zero regardless.
 */
export function formatIncompleteLine(score: number, reason: string): string {
  return (
    `Run incomplete: ${reason}\n` +
    `Score over executed tests: ${score} (not a verdict — exit code 1 regardless of --min-score)`
  );
}

/**
 * The summary line stating what a run actually spent (design
 * report-what-it-spent, D1/D4).
 *
 * Lives here, with the other summary lines, rather than in the console command:
 * the JUnit and HTML reports take the same figures from the same
 * {@link BudgetSpend}, and formatting it where only the console can see it is
 * how three surfaces start disagreeing about what a run cost.
 *
 * Deliberately not currency. The same reasoning that keeps the budget itself
 * denominated in calls and tokens applies to reporting them: a price table is
 * wrong the day a provider reprices, and wrong for anyone behind a gateway.
 * Digits are plain, not locale-grouped, so the line is identical everywhere it
 * is read or asserted on.
 */
export function formatSpendLine(spend: BudgetSpend): string {
  const calls =
    spend.maxCalls === undefined
      ? `${spend.calls} model call(s)`
      : `${spend.calls} of ${spend.maxCalls} model call(s)`;

  // Zero tokens counted and zero tokens reported are different facts, and only
  // one of them is about the run (design D1).
  if (spend.callsWithUsage === 0) {
    return `Spent: ${calls}; token usage not reported by the provider`;
  }
  const tokens =
    spend.maxTokens === undefined
      ? `${spend.tokens} token(s)`
      : `${spend.tokens} of ${spend.maxTokens} token(s)`;
  const coverage =
    spend.callsWithUsage < spend.calls
      ? ` (tokens reported by ${spend.callsWithUsage} of ${spend.calls} call(s))`
      : '';
  return `Spent: ${calls}, ${tokens}${coverage}`;
}
