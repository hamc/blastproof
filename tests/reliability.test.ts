import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  checkMutants,
  loadMutants,
  materialize,
  MutantError,
  parseMutants,
  type Mutant,
} from '../evals/reliability/mutants.js';
import { authFailure, formatRate, parseJUnit, scoreMutant, scoreSuite, wilsonUpper } from '../evals/reliability/score.js';
import { renderJUnit } from '../src/report/junit.js';
import type { TestResult } from '../src/runner/executor.js';

const literal = (over: Partial<Mutant> = {}): Mutant => ({
  id: 'discount-10pct',
  class: 'literal',
  test: '.blastproof/tests/cart-discount.yaml',
  step: 'verify a 20% discount of $24.00 is shown',
  bug: 'SAVE20 takes 10% off',
  edits: [{ file: 'app.js', find: 'discount = subtotal * 0.2;', replace: 'discount = subtotal * 0.1;' }],
  ...over,
});

describe('mutants (design measure-verdict-reliability, D1)', () => {
  it('applies an edit whose text occurs exactly once', () => {
    expect(applyEdit('a = 1; b = 2;', { file: 'x', find: 'b = 2', replace: 'b = 3' })).toBe('a = 1; b = 3;');
  });

  it('takes the replacement literally, never as a pattern', () => {
    expect(applyEdit('x', { file: 'f', find: 'x', replace: "$& and $'" })).toBe("$& and $'");
  });

  it('refuses an edit whose text is missing, so a mutant cannot run against the correct app', () => {
    expect(() => applyEdit('a = 1;', { file: 'app.js', find: 'b = 2', replace: '' })).toThrow(
      new MutantError('app.js: the text to replace occurs 0 times, not once'),
    );
  });

  it('refuses an edit whose text occurs twice, since which one breaks is then unknown', () => {
    expect(() => applyEdit('b = 2; b = 2;', { file: 'app.js', find: 'b = 2', replace: '' })).toThrow(/occurs 2 times/);
  });

  it('refuses a subtle mutant that names no incident, naming the mutant', () => {
    const { incident: _, ...bare } = literal({ id: 'shy', class: 'subtle' });
    expect(() => parseMutants([bare])).toThrow(/mutant shy: incident: a subtle mutant names the incident/);
  });

  it('refuses an id declared twice', () => {
    expect(() => parseMutants([literal(), literal()])).toThrow(/mutant discount-10pct: id declared twice/);
  });

  it('reports a step its target test does not have', async () => {
    const problems = await checkMutants([literal({ step: 'verify something nobody wrote' })]);
    expect(problems).toEqual([
      'mutant discount-10pct: .blastproof/tests/cart-discount.yaml has no step "verify something nobody wrote"',
    ]);
  });

  // The guard that matters most: the demo app is edited for other reasons, and
  // this fails in CI, without a key, when an edit moves a mutant's text.
  it('every declared mutant applies to the demo app as it is and names a real step', async () => {
    const mutants = loadMutants();
    expect(mutants.length).toBeGreaterThan(0);
    expect(await checkMutants(mutants)).toEqual([]);
  });

  it('declares both classes', () => {
    const classes = new Set(loadMutants().map((m) => m.class));
    expect([...classes].sort()).toEqual(['literal', 'subtle']);
  });

  it('materializes a copy with the edits, leaving the demo app untouched', async () => {
    const app = await mkdtemp(path.join(tmpdir(), 'bp-app-'));
    const dest = path.join(await mkdtemp(path.join(tmpdir(), 'bp-copy-')), 'app');
    try {
      await mkdir(app, { recursive: true });
      await writeFile(path.join(app, 'app.js'), 'discount = subtotal * 0.2;');
      await materialize(dest, literal(), app);
      expect(await readFile(path.join(dest, 'app.js'), 'utf8')).toBe('discount = subtotal * 0.1;');
      expect(await readFile(path.join(app, 'app.js'), 'utf8')).toBe('discount = subtotal * 0.2;');
    } finally {
      await rm(app, { recursive: true, force: true });
      await rm(path.dirname(dest), { recursive: true, force: true });
    }
  });
});

function result(status: TestResult['status'], over: Partial<TestResult> = {}): TestResult {
  return {
    file: '/repo/.blastproof/tests/cart-discount.yaml',
    summary: 'Promo code SAVE20 applies a 20% discount in the cart',
    priority: 'P0',
    tags: [],
    status,
    steps: [],
    durationMs: 1000,
    ...over,
  };
}

const junit = (r: TestResult) => parseJUnit(renderJUnit([r], [], { score: 0, durationMs: 1000, cwd: '/repo' }));

describe('scoring (design measure-verdict-reliability, D3)', () => {
  const step = 'verify a 20% discount of $24.00 is shown';

  it('reads the report the CLI writes: file, summary, status and failing step, unescaped', () => {
    const [testcase] = junit(result('failed', { failedStep: 'verify "A & B" <shown>', reason: 'no' }));
    expect(testcase).toEqual({
      file: '.blastproof/tests/cart-discount.yaml',
      summary: 'Promo code SAVE20 applies a 20% discount in the cart',
      status: 'failed',
      failedStep: 'verify "A & B" <shown>',
    });
  });

  it('a mutant failed at its declared step is caught', () => {
    expect(scoreMutant(junit(result('failed', { failedStep: step, reason: 'r' }))[0], step)).toBe('caught');
  });

  it('a mutant failed at another step is caught elsewhere, not caught', () => {
    expect(scoreMutant(junit(result('failed', { failedStep: 'navigate to the cart page', reason: 'r' }))[0], step)).toBe(
      'caught-elsewhere',
    );
  });

  it('a mutant whose target passes is a false PASS', () => {
    expect(scoreMutant(junit(result('passed'))[0], step)).toBe('false-pass');
  });

  it('a run that stopped, or wrote no report, is incomplete rather than a verdict', () => {
    expect(scoreMutant(junit(result('not-run', { reason: 'budget' }))[0], step)).toBe('incomplete');
    expect(scoreMutant(undefined, step)).toBe('incomplete');
    expect(scoreSuite(undefined)).toBe('incomplete');
  });

  // Found by the first full run: gpt-4o-mini pressed Enter while filling the
  // password, the sign-in failed, and the run exited 2 with no report.
  it('a sign-in that failed is a verdict the user received, not a run that did not count', () => {
    const log = 'error: Authentication failed at step "fill the password field with demo123": no\n[exit 2]';
    expect(authFailure(log)).toBe('fill the password field with demo123');
    expect(authFailure('[exit 0]')).toBeUndefined();
    expect(scoreSuite(undefined, 'fill the password field with demo123')).toBe('false-fail');
    expect(scoreMutant(undefined, step, 'fill the password field with demo123')).toBe('caught-elsewhere');
  });

  it('a failure on the unmodified app is a false FAIL', () => {
    expect(scoreSuite(junit(result('failed', { failedStep: step, reason: 'r' }))[0])).toBe('false-fail');
    expect(scoreSuite(junit(result('passed'))[0])).toBe('pass');
  });

  it('bounds a rate of zero instead of claiming zero', () => {
    expect(wilsonUpper(0, 60)).toBeCloseTo(0.0602, 3);
    expect(wilsonUpper(5, 10)).toBeCloseTo(0.7634, 3);
    expect(wilsonUpper(0, 0)).toBe(1);
    expect(formatRate(0, 60)).toBe('0/60 (0.0%, ≤ 6.0% at 95%)');
    expect(formatRate(0, 0)).toBe('no decided sample');
  });
});
