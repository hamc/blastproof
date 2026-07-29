import { describe, expect, it } from 'vitest';
import { computeScore, formatIncompleteLine, formatScoreLine, WEIGHTS } from '../src/report/score.js';
import type { TestResult } from '../src/runner/executor.js';

function result(priority: string, status: 'passed' | 'failed' | 'not-run'): TestResult {
  return {
    file: `.blastproof/tests/${priority}-${status}.yaml`,
    summary: `${priority} ${status}`,
    priority,
    tags: [],
    status,
    steps: [],
    durationMs: 1000,
  };
}

describe('computeScore', () => {
  it('scores 100 when every executed test passes', () => {
    const results = [result('P0', 'passed'), result('P1', 'passed'), result('P2', 'passed')];
    expect(computeScore(results)).toBe(100);
  });

  it('weights a P0 failure three times a P2 pass', () => {
    // P0 fails (weight 3), P2 passes (weight 1) => 1 of 4 weight units.
    expect(computeScore([result('P0', 'failed'), result('P2', 'passed')])).toBe(25);
  });

  it('costs less when the failing test is low priority', () => {
    const failingP0 = [result('P0', 'failed'), result('P2', 'passed')];
    const failingP2 = [result('P0', 'passed'), result('P2', 'failed')];
    expect(computeScore(failingP0)).toBeLessThan(computeScore(failingP2));
    expect(computeScore(failingP2)).toBe(75);
  });

  it('scores 100 for an empty selection', () => {
    expect(computeScore([])).toBe(100);
  });

  it('rounds to the nearest integer', () => {
    // Two P1 pass, one P1 fail => 4/6 = 66.67 -> 67
    const results = [result('P1', 'passed'), result('P1', 'passed'), result('P1', 'failed')];
    expect(computeScore(results)).toBe(67);
  });

  it('counts an unparseable test file as a failure', () => {
    // A broken file enters the results as a failed P1 (design D3).
    const broken: TestResult = {
      file: '.blastproof/tests/broken.yaml',
      summary: 'broken.yaml',
      priority: 'P1',
      tags: [],
      status: 'failed',
      steps: [],
      reason: 'Invalid test file',
      durationMs: 0,
    };
    expect(computeScore([result('P1', 'passed'), broken])).toBe(50);
  });

  it('falls back to the P1 weight for an unknown priority', () => {
    expect(WEIGHTS.P1).toBe(2);
    expect(computeScore([result('P9', 'passed')])).toBe(100);
  });

  it('excludes not-run tests from the denominator, rather than counting them as failures (design D4)', () => {
    // If not-run counted as a failure this would score 50 (1 of 2 weight units);
    // excluded, it scores 100 — the one executed test's own result decides it.
    expect(computeScore([result('P0', 'passed'), result('P0', 'not-run')])).toBe(100);
  });

  it('scores 100 when every test is not run (an empty-equivalent denominator)', () => {
    expect(computeScore([result('P0', 'not-run'), result('P1', 'not-run')])).toBe(100);
  });
});

describe('formatScoreLine', () => {
  it('states the empty case so 100 is not mistaken for verified quality', () => {
    expect(formatScoreLine(100, [])).toContain('no tests executed');
  });

  it('reports the bare score without a threshold', () => {
    expect(formatScoreLine(75, [result('P1', 'failed')])).toBe('Score: 75');
  });

  it('names the threshold and the verdict when gating', () => {
    const results = [result('P1', 'failed')];
    expect(formatScoreLine(60, results, 80)).toContain('min-score 80');
    expect(formatScoreLine(60, results, 80)).toContain('FAIL');
    expect(formatScoreLine(85, results, 80)).toContain('pass');
  });
});

describe('formatIncompleteLine (spec run-budget, design D3/D4)', () => {
  it('names the stop reason and states the score is not a verdict', () => {
    const line = formatIncompleteLine(100, 'model call budget exhausted: reached the configured maximum of 5 call(s)');
    expect(line).toContain('Run incomplete');
    expect(line).toContain('model call budget exhausted');
    expect(line).toContain('not a verdict');
    expect(line).toContain('regardless of --min-score');
  });
});
