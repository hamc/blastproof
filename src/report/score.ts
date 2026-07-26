import type { TestResult } from '../runner/executor.js';

/** Priority weights: a failing P0 costs three times a failing P2 (design D1). */
export const WEIGHTS: Record<string, number> = { P0: 3, P1: 2, P2: 1 };

const DEFAULT_WEIGHT = WEIGHTS.P1!;

/**
 * Weighted pass rate over executed tests, rounded to an integer 0–100.
 * An empty result list scores 100: nothing ran, so nothing is at risk (design D2).
 * Pure — the caller owns all I/O.
 */
export function computeScore(results: TestResult[]): number {
  let total = 0;
  let passed = 0;
  for (const result of results) {
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
